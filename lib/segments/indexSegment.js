var MotionSegment = require('./motionSegment');
var BasicSegmentFactory = require('./basicSegment');
var AccelSegment = require('./accelSegment');
var FastMath = require('../util/FastMath');
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


IndexMotionSegment.prototype.exportData = function () {

	var dataObj = MotionSegment.MotionSegment.prototype.exportData.call(this);
	dataObj.type = 'IndexMotionSegment';

	return dataObj;
};


IndexMotionSegment.prototype.importFromData = function (data) {
	if (data.constructor === "IndexSegment") {
		return new IndexSegment(
			data.initialTime, // t0
			data.finalTime, // tf
			data.initialPosition, // p0
			data.finalPosition, // pf
			data.initialVelocity, // v
			data.velLimPos,
			data.velLimNeg,
			data.accJerk,
			data.decJerk,
			data.xSkew,
			data.ySkew,
			data.shape,
			data.mode,
			data.loads);
	}

	throw new Error("Unknown IndexSegment type: " + data.constructor);
};


var IndexSegment = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode, loads) {

	if (mode !== "absolute")
		mode = "incremental";

	var loads_copy = {};
	Util.extend(loads_copy, loads);

	this.segmentData = {
		initialTime: t0,
		finalTime: tf,
		initialVelocity: v,
		finalVelocity: v,
		initialPosition: p0,
		finalPosition: pf,
		duration: tf - t0,
		distance: pf - p0,
		velLimNeg: velLimNeg,
		velLimPos: velLimPos,
		accJerk: accJerk,
		decJerk: decJerk,
		xSkew: xSkew,
		ySkew: ySkew,
		shape: shape,
		mode: mode,
		loads: loads_copy
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape);

	IndexMotionSegment.call(this, basicSegments);
	this.setBasicSegmentLoads(loads_copy);
};


IndexSegment.prototype = Object.create(IndexMotionSegment.prototype);
IndexSegment.prototype.constructor = IndexSegment;


/**
 * Calculates and creates the 1 to 7 basic segments that IndexSegment consists of
 * @param  {Number} t0   		[initial time]
 * @param  {Number} tf   		[final time]
 * @param  {Number} p0   		[initial position]
 * @param  {Number} pf   		[final position]
 * @param  {Number} v    		[start and end velocity]
 * @param  {Number} velLimPos 	[positive velocity limit (null/Inf if not applicable) <0,Inf>]
 * @param  {Number} velLimNeg	[negative velocity limit (null/-Inf if not applicable) <-Inf, 0>]
 * @param  {Number} accJerk 	[percent jerk applied to the first trapezoid <0,1>. This value applies to the first trapzeoid regardless of whether or not it is accel or decel.]
 * @param  {Number} decJerk   	[percent jerk applied to the second trapezoid <0,1>]
 * @param  {Number} xSkew		[time skew <-1,1>]
 * @param  {Number} ySkew 		[velocity skew <0,1>]
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
	} else if (ySkew === null) {
		ySkew = 0.5;
	}

	/**
	 * the xskew does NOT affect the size of the coast segment. it only affects how the total acceldecel time is split between the accel and decel curve
	 */
	if (xSkew === null)
		xSkew = 0;

	var dp = pf - p0;
	var dt = tf - t0;
	// var s = dp/abs(dp); // sign of position change
	var v_ave = dp / dt - v; // average velocity
	var vmax = v + (1 + ySkew) * v_ave; // max velocity

	// if calculated vm is outside velocity bounds, correct ySkew and vmax
	if (velLimPos !== null && FastMath.gt(vmax, velLimPos)) {
		ySkew = (velLimPos - v) / v_ave - 1;
		vmax = velLimPos;
		// throw new Error('Maximum velocity exceeds positive velocity limit. Changing ySkew.'); // this should probably be changed to a real error/warning.
		if (FastMath.lt(ySkew,  0) || FastMath.gt(ySkew, 1))
			throw new Error('Positive velocity limit too low');
	} else if (velLimNeg !== null && FastMath.lt(vmax, velLimNeg)) {
		ySkew = (velLimNeg - v) / v_ave - 1;
		vmax = velLimNeg;
		// throw new Error('Maximum velocity exceeds negative velocity limit. Changing ySkew.');
		if (FastMath.lt(ySkew,  0) || FastMath.gt(ySkew, 1))
			throw new Error('Negative velocity limit too high');
	}

	// we may have just thrown yskew out of bounds
	if (FastMath.lt(ySkew,  0) || FastMath.gt(ySkew, 1))
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

	// there may be a significant problem with this code. What happens if we have a triangle and jerks match??? There's only 3 segments.
	// This code produces four though. Need to consider if this is going to be an issue. I don't think it will be though. -Brian G. Mar 16 2017

	// Create coast basic segment
	if (coast_time > 0) {
		outputSegs = [].concat(outputSegs, BasicSegmentFactory.CreateBasicSegment(t0 + acc_time, t0 + acc_time + coast_time, [0, 0, vmax, nextPosition]));
		nextPosition = outputSegs[outputSegs.length - 1].evaluatePositionAt(t0 + acc_time + coast_time);
	}

	// decel segment
	outputSegs = [].concat(outputSegs, AccelSegment.calculateTimeVelocityBasicSegments(t0 + acc_time + coast_time, tf, nextPosition, vmax, v, decJerk));

	return outputSegs;
};


/**
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * Modification takes into account absolute vs incremental mode
 * @param {MotionPoint} startPoint position/velocity/accel/jerk definition
 */
IndexSegment.prototype.modifyInitialValues = function(startPoint) {
	var tf;
	var pf;
	var t0 = startPoint.time;
	var a0 = startPoint.acceleration;
	var v0 = startPoint.velocity;
	var p0 = startPoint.position;

	if (this.segmentData.mode === 'incremental') {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.distance;
	} else if (this.segmentData.mode == 'absolute') {
		tf = this.segmentData.finalTime;
		pf = this.segmentData.finalPosition;
		if (FastMath.leq(tf, t0))
			throw new Error('Attempt to move initial time past absolute final time');
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

	this.segmentData.duration = tf-t0;
	this.segmentData.distance = pf-p0;
	this.segmentData.finalTime = tf;
	this.segmentData.initialTime = startPoint.time;
	this.segmentData.initialVelocity = startPoint.velocity;
	this.segmentData.finalVelocity = startPoint.velocity;
	this.segmentData.initialPosition = startPoint.position;
	this.segmentData.finalPosition = pf;

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
	if (newSegmentData.mode == 'absolute' || newSegmentData.mode == 'incremental') {
		this.segmentData.mode = newSegmentData.mode;
	}

	this.segmentData.initialTime = (initialConditions.time || initialConditions.time === 0) ? initialConditions.time : this.segmentData.initialTime;
	this.segmentData.initialVelocity = (initialConditions.velocity || initialConditions.velocity === 0) ? initialConditions.velocity : this.segmentData.initialVelocity;
	this.segmentData.finalVelocity = (initialConditions.velocity || initialConditions.velocity === 0) ? initialConditions.velocity : this.segmentData.finalVelocity;
	this.segmentData.initialPosition = (initialConditions.position || initialConditions.position === 0) ? initialConditions.position : this.segmentData.initialPosition;
	this.segmentData.velLimNeg = (newSegmentData.velLimNeg || newSegmentData.velLimNeg === 0 || newSegmentData.velLimNeg === null) ? newSegmentData.velLimNeg : this.segmentData.velLimNeg;
	this.segmentData.velLimPos = (newSegmentData.velLimPos || newSegmentData.velLimPos === 0 || newSegmentData.velLimPos === null) ? newSegmentData.velLimPos : this.segmentData.velLimPos;
	this.segmentData.accJerk = (newSegmentData.accJerk || newSegmentData.accJerk === 0) ? newSegmentData.accJerk : this.segmentData.accJerk;
	this.segmentData.decJerk = (newSegmentData.decJerk || newSegmentData.decJerk === 0) ? newSegmentData.decJerk : this.segmentData.decJerk;
	// this.segmentData.xSkew = (newSegmentData.xSkew || newSegmentData.xSkew === 0) ? newSegmentData.xSkew : this.segmentData.xSkew;
	// this.segmentData.ySkew = (newSegmentData.ySkew || newSegmentData.ySkew === 0) ? newSegmentData.ySkew : this.segmentData.ySkew;
	this.segmentData.xSkew = this.segmentData.xSkew;
	this.segmentData.ySkew = this.segmentData.ySkew; // these should be replaced in a later version
	this.segmentData.shape = (newSegmentData.shape == 'triangle' || newSegmentData.shape == 'trapezoid') ? newSegmentData.shape : this.segmentData.shape;
	// this.segmentData.shape = (newSegmentData.shape || newSegmentData.shape === 0) ? newSegmentData.shape : this.segmentData.shape;

	if (this.segmentData.mode == 'incremental') {
		this.segmentData.duration = (newSegmentData.duration || newSegmentData.duration === 0) ? newSegmentData.duration : this.segmentData.duration;
		this.segmentData.distance = (newSegmentData.distance || newSegmentData.distance === 0) ? newSegmentData.distance : this.segmentData.distance;

		this.segmentData.finalTime = initialConditions.time + this.segmentData.duration;
		this.segmentData.finalPosition = initialConditions.position + this.segmentData.distance;
	} else if (this.segmentData.mode == 'absolute') {
		this.segmentData.finalTime = (newSegmentData.finalTime || newSegmentData.finalTime === 0) ? newSegmentData.finalTime : this.segmentData.finalTime;
		this.segmentData.finalPosition = (newSegmentData.finalPosition || newSegmentData.finalPosition === 0) ? newSegmentData.finalPosition : this.segmentData.finalPosition;

		this.segmentData.duration = this.segmentData.finalTime - this.segmentData.initialTime;
		this.segmentData.distance = this.segmentData.finalPosition - this.segmentData.initialPosition;
	}

	// consider replacing all this junk with _.mergeWith
	this.initialTime = this.segmentData.initialTime;
	this.finalTime = this.segmentData.finalTime;

	var newLoads = {};
	Util.extend(newLoads, this.segmentData.loads);
	Util.extend(newLoads, newSegmentData.loads);
	// this.segmentData.loads = newLoads;

	var newBasicSegments = this.calculateBasicSegments(
		this.segmentData.initialTime,
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
	this.setBasicSegmentLoads(newLoads);

	return this;
};


IndexSegment.prototype.invert = function () {
	this.modifySegmentValues({
		finalPosition: this.segmentData.initialPosition - this.segmentData.distance,
		distance: -this.segmentData.distance
	}, {
		time: null,
		position: null,
		velocity: null
	});

	return this.segmentData;
};

/**
 * Makes a new IndexMotionSegment given velocity information
 * @param {Number} t0 				[initial time]
 * @param {Number} tf 				[final time]
 * @param {Number} p0 				[initial position]
 * @param {Number} pf 				[final position]
 * @param {Number} v 				[initial/final velocity]
 * @param {Number} velLimPos		[positive velocity limit, default is null]
 * @param {Number} velLimNeg		[negative velocity limit, default is null]
 * @param {Number} accJerk			[acc curve jerk percent]
 * @param {Number} decJerk			[dec curve jerk percent]
 * @param {Number} xSkew			[x skew value <-1,1>, default is 0]
 * @param {Number} ySkew			[y skew value <0,1>, default is 0.5]
 * @param {string} shape			['triangle' or 'trapezoid']
 * @param {string} mode				['incremental' or 'absolute']
 * @returns {IndexMotionSegment}	[freshly created index segment]
 */
factory.Make = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode, loads) {
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

	if (FastMath.equal(p0,pf)) {
		throw new Error('expecting nonzero position change');
	}

	if (Util.isUndefined(velLimPos) && velLimPos > v)
		throw new Error('expecting positive velocity limit to be greater than v or null');

	if (Util.isUndefined(velLimNeg) && velLimNeg < v)
		throw new Error('expecting positive velocity limit to be greater than v or null');

	var indexSegment = new IndexSegment(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode, loads);

	return indexSegment;
};


factory.IndexMotionSegment = IndexMotionSegment;

module.exports = factory;