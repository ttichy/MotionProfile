var MotionSegment = require('./motionSegment');
var basicSegmentFactory = require('./basicSegment');
var AccelSegment = require('./accelSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var factory = {};

/**
 * IndexMotion segment constructor
 * @param {Array} basicSegments [array of basic segments]
 */
var IndexMotionSegment = function(basicSegments) {
	if (!Array.isArray(basicSegments))
		throw new Error('Expecting an array parameter');
	if (basicSegments.length < 1 || basicSegments.length > 7)
		throw new Error('Expecting aray length to be at least one, but less than or equal to 7');

	var t0 = basicSegments[0].initialTime;
	var tf = basicSegments[basicSegments.length - 1].finalTime;

	MotionSegment.MotionSegment.call(this, t0, tf);

	for (var i = 1; i < basicSegments.length; i++) {
		if (basicSegments[i].finalTime <= basicSegments[i - 1].finalTime) {
			throw new Error('time mismatch in index segment');
		}
	}

	this.type = 'index';

	// each segment (regardless of type) has initialTime and finalTime
	this.initialTime = basicSegments[0].initialTime;
	this.finalTime = basicSegments[basicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(basicSegments);
};


IndexMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
IndexMotionSegment.prototype.constructor = IndexMotionSegment;

IndexMotionSegment.prototype.EvaluatePositionAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	return segment.evaluatePositionAt(x);
};


IndexMotionSegment.prototype.EvaluateVelocityAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	return segment.evaluateVelocityAt(x);
};


IndexMotionSegment.prototype.EvaluateAccelerationAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	return segment.evaluateAccelerationAt(x);
};


IndexMotionSegment.prototype.FindSegmentAtTime = function(time) {
	var segment = this.segments.getAllSegments().filter(function(bSeg) {
		return fastMath.geq(time, bSeg.initialTime) && fastMath.leq(time, bSeg.finalTime);
	});

	if (!Util.isObject(segment[0]))
		throw new Error("Couldn't find basic segment that contains time " + time);

	// could have two segments, if time falls right at the end of the first segment
	// and the beginning of 2nd
	if (segment.length > 2)
		throw new Error("Found " + segment.length + " segments, expecting 1 or 2.");

	//since all profile variables (p,v,a) are continuous, we'll just pick the first one
	return segment[0];
};


IndexMotionSegment.prototype.getAll = function() {
	return this.segments.getAllSegments();
};


/**
 * Calculates final time, acceleration, velocity and position for this segment
 * @return {Array} [tf,af,vf,pf]
 */
IndexMotionSegment.prototype.getFinalValues = function() {
	var last = this.segments.lastSegment();
	var tf = last.finalTime;
	var af = last.evaluateAccelerationAt(tf);
	var vf = last.evaluateVelocityAt(tf);
	var pf = last.evaluatePositionAt(tf);

	return [tf, af, vf, pf];
};


/**
 * Calculates initial time, acceleration, velocity and position for this segment
 * @return {Array} [tf,af,vf,pf]
 */
IndexMotionSegment.prototype.getInitialValues = function() {
	var last = this.segments.firstSegment();
	var t0 = last.initialTime;
	var a0 = last.evaluateAccelerationAt(t0);
	var v0 = last.evaluateVelocityAt(t0);
	var p0 = last.evaluatePositionAt(t0);

	return [t0, a0, v0, p0];
};


var IndexSegment = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {

	if (mode !== "absolute")
		mode = "incremental";

	this.segmentData = {
		mode: mode,
		initialTime: t0,
		finalTime: tf,
		duration: tf - t0,
		initalVelocity: v,
		finalVelocity: v,
		initialPosition: p0,
		finalPosition: pf,
		velLimNeg: velLimNeg,
		velLimPos: velLimPos,
		accJerk: accJerk,
		decJerk: decJerk,
		xSkew: xSkew,
		ySkew: ySkew,
		shape: shape
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape);

	IndexMotionSegment.call(this, basicSegments);
};


IndexSegment.prototype = Object.create(IndexMotionSegment.prototype);
IndexSegment.prototype.constructor = IndexSegment;


/**
 * Calculates and creates the 1 to 7 basic segments that IndexSegment consists of
 * @param  {Number} t0   		[initial time]
 * @param  {Number} tf   		[finalt time]
 * @param  {Number} p0   		[initial position]
 * @param  {Number} pf   		[final position]
 * @param  {Number} v    		[start and end velocity]
 * @param  {Number} velLimPos 	[positive velocity limit (null/Inf if not applicable) <0,Inf>]
 * @param  {Number} velLimNeg	[negative velocity limit (null/-Inf if not applicable) <-Inf, 0>]
 * @param  {Number} accJerk 	[percent jerk applied to the first trapezoid <0,1>. This value applies to the first trapzeoid regardless of whether or not it is accel or decel.]
 * @param  {Number} decJerk   	[percent jerk applied to the second trapezoid <0,1>]
 * @param  {Number} xSkew		[time skew <-1,1>]
 * @param  {Number} ySkew 		[velocity skew <-1,1>]
 * @param  {String} shape		[shape of the velocity profile ("trapezoid", "triangle")]
 * @return {Array}				[Array of BasicSegment]
 */
IndexSegment.prototype.calculateBasicSegments = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape) {

	/**
	 * yskew affects the maximum velocity. limiting the maximum velocity or minimum velocity is the same as modifying the yskew. velocity
	 * limits override the yskew value.
	 */
	if (shape == "triangle") {
		ySkew = 1;
	} else if (ySkew == null) {
		ySkew = 0.5;
	}

	/**
	 * the xskew does NOT affect the size of the coast segment. it only affects how the total acceldecel time is split between the accel and decel curve
	 */
	if (xSkew == null)
		xSkew = 0;

	var dp = pf - p0;
	var dt = tf - t0;
	// var s = dp/abs(dp); // sign of position change
	var v_ave = dp / dt - v; // average velocity
	var vmax = v + (1 + ySkew) * v_ave; // max velocity

	// if calculated vm is outside velocity bounds, correct ySkew and vmax
	if (velLimPos !== null && vmax > velLimPos) {
		ySkew = (velLimPos - v) / v_ave - 1;
		vmax = velLimPos;
		console.warn('Maximum velocity exceeds positive velocity limit. Changing ySkew.'); // this should probably be changed to a real error/warning.
	} else if (velLimNeg !== null && vmax < velLimNeg) {
		ySkew = (velLimNeg - v) / v_ave - 1;
		vmax = velLimNeg;
		console.warn('Maximum velocity exceeds negative velocity limit. Changing ySkew.');
	}

	// we may have just thrown yskew out of bounds
	if (ySkew > 1 || ySkew < 0)
		throw new Error('Conflict between y skew and maximum velocity');

	// apply ySkew
	var modifiedYSkew = 1 - 1 / (1 + ySkew);
	var accdec_time = modifiedYSkew * dt * 2;
	var coast_time = dt - accdec_time;

	// apply xSkew
	var acc_time = accdec_time / 2 * (1 + xSkew);
	var dec_time = dt - acc_time - coast_time;

	var outputSegs = [];

	// accel segment
	var nextPosition;
	if (acc_time > 0) {
		outputSegs = [].concat(outputSegs, AccelSegment.calculateTimeVelocityBasicSegments(t0, t0 + acc_time, p0, v, vmax, accJerk));
		nextPosition = outputSegs[outputSegs.length - 1].evaluatePositionAt(t0 + acc_time);
	} else {
		nextPosition = p0;
	}

	// Create coast basic segment
	if (coast_time > 0) {
		outputSegs = [].concat(outputSegs, basicSegmentFactory.CreateBasicSegment(t0 + acc_time, t0 + acc_time + coast_time, [0, 0, vmax, nextPosition]));
		nextPosition = outputSegs[outputSegs.length - 1].evaluatePositionAt(t0 + acc_time + coast_time);
	}

	// decel segment
	outputSegs = [].concat(outputSegs, AccelSegment.calculateTimeVelocityBasicSegments(t0 + acc_time + coast_time, tf, nextPosition, vmax, v, decJerk));

	return outputSegs;
};



/**
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * Modification takes into account absolute vs incremental mode
 * @param {float} t0 new initial time
 * @param {float} a0 new initial acceleration
 * @param {float} v0 new initial velocity
 * @param {float} p0 new initial position
 */
IndexSegment.prototype.modifyInitialValues = function(t0, a0, v0, p0) {

	var tf;
	var pf;
	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.finalPosition - this.segmentData.initialPosition;
	} else {
		tf = this.segmentData.finalTime;
		pf = this.segmentData.finalPosition;
		this.segmentData.duration = tf - t0;
		if (fastMath.lt(this.segmentData.duration, 0))
			throw new Error('tried to move initial time past final time for absolute segment');
	}

	var newBasicSegments = this.calculateBasicSegments(t0,
		tf,
		p0,
		pf,
		v0,
		this.segmentData.velLimPos,
		this.segmentData.velLimNeg,
		this.segmentData.accJerk,
		this.segmentData.decJerk,
		this.segmentData.xSkew,
		this.segmentData.ySkew,
		this.segmentData.shape
	);

	this.initialTime = newBasicSegments[0].initialTime;
	this.finalTime = newBasicSegments[newBasicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};


/**
 * Edit user entered segment values
 * @param  {Object} newSegmentData      new user entered data
 * @param {Object} initialConditions initial conditions
 */
IndexSegment.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {

	if (newSegmentData.mode !== "absolute")
		newSegmentData.mode = "incremental";

	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.initialTime = initialConditions.time || this.segmentData.initialTime;
	this.segmentData.finalTime = newSegmentData.finalTime || this.segmentData.finalTime;
	this.segmentData.initalVelocity = initialConditions.velocity || this.segmentData.initalVelocity;
	this.segmentData.finalVelocity = initialConditions.velocity || this.segmentData.finalVelocity;
	this.segmentData.initialPosition = initialConditions.position || this.segmentData.initialPosition;
	this.segmentData.finalPosition = newSegmentData.finalPosition || this.segmentData.finalPosition;
	this.segmentData.velLimNeg = newSegmentData.velLimNeg || this.segmentData.velLimNeg;
	this.segmentData.velLimPos = newSegmentData.velLimPos || this.segmentData.velLimPos;
	this.segmentData.accJerk = newSegmentData.accJerk || this.segmentData.accJerk;
	this.segmentData.decJerk = newSegmentData.decJerk || this.segmentData.decJerk;
	this.segmentData.xSkew = newSegmentData.xSkew || this.segmentData.xSkew;
	this.segmentData.ySkew = newSegmentData.ySkew || this.segmentData.ySkew;
	this.segmentData.shape = newSegmentData.shape || this.segmentData.shape;

	this.segmentData.duration = this.segmentData.finalTime - this.segmentData.initialTime;

	var newBasicSegments = this.calculateBasicSegments(this.segmentData.initialTime,
		this.segmentData.finalTime,
		this.segmentData.initialPosition,
		this.segmentData.finalPosition,
		this.segmentData.initialVelocity,
		this.segmentData.velLimPos,
		this.segmentData.velLimNeg,
		this.segmentData.accJerk,
		this.segmentData.decJerk,
		this.segmentData.xSkew,
		this.segmentData.ySkew,
		this.segmentData.shape
	);

	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};


/**
 * Makes a new IndexMotionSegment given velocity information
 * @param {Number} t0 				[initial time]
 * @param {Number} tf 				[final time]
 * @param {Number} p0 				[initial position]
 * @param {Number} pf 				[final position]
 * @param {Number} v 				[initial/final velocity]
 * @param {Number} velLimPos		[positive velocity limit]
 * @param {Number} velLimNeg		[negative velocity limit]
 * @param {Number} accJerk			[acc curve jerk percent]
 * @param {Number} decJerk			[dec curve jerk percent]
 * @param {Number} xSkew			[x skew value <-1,1>]
 * @param {Number} ySkew			[y skew value <0,1>]
 * @param {string} shape			[triangle or trapezoid]
 * @param {string} mode				[incremental or absolute]
 * @returns {IndexMotionSegment}	[freshly created index segment]
 */
factory.Make = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {
	// data validation
	if (Util.isUndefined(accJerk) || accJerk < 0 || accJerk > 1)
		throw new Error('expecting accel jerk between <0,1>');

	if (Util.isUndefined(decJerk) || decJerk < 0 || decJerk > 1)
		throw new Error('expecting decel jerk between <0,1>');

	if (xSkew < -1 || xSkew > 1)
		throw new Error('expecting xSkew between <-1,1>');

	if (ySkew < 0 || ySkew > 1)
		throw new Error('expecting ySkew between <0,1>');

	if (tf < t0)
		throw new Error('expecting tf to come after t0');

	if ((pf - p0) < 0)
		throw new Error('expecting nonzero position change');

	if (velLimPos !== null && velLimPos > v)
		throw new Error('expecting positive velocity limit to be greater than v or null');

	if (velLimNeg !== null && velLimNeg < v)
		throw new Error('expecting positive velocity limit to be greater than v or null');

	var indexSegment = new IndexSegment(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode);

	return indexSegment;
};


factory.IndexMotionSegment = IndexMotionSegment;

module.exports=factory;