
var MotionSegment = require('motionSegment');
var basicSegmentFactory = require('basicSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var factory = {};

/**
 * AccelMotion segment constructor
 * @param {Array} basicSegments [array of basic segments]
 */
var AccelMotionSegment = function(basicSegments) {
	if (!Array.isArray(basicSegments))
		throw new Error('Expecting an array parameter');
	if (basicSegments.length < 1 || basicSegments.length > 3)
		throw new Error('Expecting aray length to be 1,2 or 3');

	var t0 = basicSegments[0].initialTime;
	var tf = basicSegments[basicSegments.length - 1].finalTime;

	MotionSegment.MotionSegment.call(this, t0, tf);

	//TODO: check ordering of the basicSegments (increasing time)

	this.type = 'acceleration';


	// each segment (regardless of type) has initialTime and finalTime
	this.initialTime = basicSegments[0].initialTime;
	this.finalTime = basicSegments[basicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(basicSegments);
};


AccelMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
AccelMotionSegment.prototype.constructor = AccelMotionSegment;

AccelMotionSegment.prototype.EvaluatePositionAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	return segment.evaluatePositionAt(x);

};

AccelMotionSegment.prototype.EvaluateVelocityAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	return segment.evaluateVelocityAt(x);
};

AccelMotionSegment.prototype.EvaluateAccelerationAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	return segment.evaluateAccelerationAt(x);
};


AccelMotionSegment.prototype.FindSegmentAtTime = function(time) {
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


AccelMotionSegment.prototype.getAll = function() {
	return this.segments.getAllSegments();
};


/**
 * Calculates final time, acceleration, velocity and position for this segment
 * @return {Array} [tf,af,vf,pf]
 */
AccelMotionSegment.prototype.getFinalValues = function() {
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
AccelMotionSegment.prototype.getInitialValues = function() {
	var last = this.segments.firstSegment();
	var t0 = last.initialTime;
	var a0 = last.evaluateAccelerationAt(t0);
	var v0 = last.evaluateVelocityAt(t0);
	var p0 = last.evaluatePositionAt(t0);

	return [t0, a0, v0, p0];
};



AccelMotionSegment.prototype.setBasicSegmentLoads = function(loads) {
	if (!loads)
		return;
	var segments = this.getAllSegments();

	for (var i = segments.length - 1; i >= 0; i--) {
		segments[i].friction = loads.friction || 0;
		segments[i].thrust = loads.thrust || 0;
		segments[i].load = loads.load || 0;
	}
};


/**
 * Gets pertinenta data to be able to serialize/deserilize segment
 * @return {object} data representation of the segment
 */
AccelMotionSegment.prototype.exportData = function() {
	var dataObj = {};

	Util.extend(dataObj, this.segmentData);
	dataObj.constructor = this.constructor.name;
	dataObj.type = 'AccelMotionSegment';

	return dataObj;

};


/**
 * Deserialize(create) AccelMotionSegment from a json string
 * @param  {Object} data data representation of the segment (see exportData())
 * @return {AccelMotionSegment}      [description]
 */
AccelMotionSegment.prototype.importFromData = function(data) {

	switch (data.constructor) {
		case "AccelSegmentTimeVelocity":
			return new AccelSegmentTimeVelocity(0, data.duration, 0, 0, data.finalVelocity, data.jerkPercent, data.mode, data.loads);

		case "AccelSegmentTimeDistance":
			return new AccelSegmentTimeDistance(0, data.duration, 0, 0, data.distance, data.jerkPercent, data.mode, data.loads);
	}

	throw new Error("Unkown AccelSegment type: " + data.constructor);

};



var AccelSegmentTimeVelocity = function(t0, tf, p0, v0, vf, jPct, mode, loads) {

	if (arguments.length <= 7)
		throw new Error("Expected at least 7 arguments in AccelSegmentTimeVelocity constructor");

	if (mode !== "absolute")
		mode = "incremental";

	var loads_copy = {};
	Util.extend(loads_copy, loads);

	this.segmentData = {
		dataPermutation: "time-velocity",
		mode: mode,
		initialTime: t0,
		finalTime: tf,
		initialVelocity: v0,
		finalVelocity: vf,
		duration: tf - t0,
		jerkPercent: jPct,
		loads: loads_copy
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, v0, vf, jPct);

	AccelMotionSegment.call(this, basicSegments);
	this.setBasicSegmentLoads(loads);

};



AccelSegmentTimeVelocity.prototype = Object.create(AccelMotionSegment.prototype);
AccelSegmentTimeVelocity.prototype.constructor = AccelSegmentTimeVelocity;


/**
 * Calculates and creates the 1 to 3 basic segments that AccelSegment consists of
 * @param  {Number} t0   initial time
 * @param  {Number} tf   finalt time
 * @param  {Number} p0   initial position
 * @param  {Number} v0   initial velocity
 * @param  {Number} vf   final velocity
 * @param  {Number} jPct jerk percentage
 * @return {Array}      Array of BasicSegment
 */
AccelSegmentTimeVelocity.prototype.calculateBasicSegments = function(t0, tf, p0, v0, vf, jPct) {
	var basicSegment, basicSegment2, basicSegment3;
	var accelSegment;
	var coeffs, coeffs1, coeffs2, coeffs3, coeffs4;

	if (jPct === 0) {
		// consists of one basic segment
		coeffs = [0, 0.5 * (vf - v0) / (tf - t0), v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, tf, coeffs);

		return [basicSegment];
	}

	var aMax;
	var jerk;
	var th;

	if (jPct == 1) {
		// two basic segments

		// th - duration of half the accel segment
		th = (tf - t0) / 2;
		aMax = (vf - v0) / th;
		jerk = aMax / th;

		coeffs1 = [jerk / 6, 0, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + th, coeffs1);

		coeffs2 = [basicSegment.evaluatePositionAt(t0 + th), basicSegment.evaluateVelocityAt(t0 + th), aMax / 2, -jerk / 6];

		basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + th, tf, coeffs2);

		return [basicSegment, basicSegment2];
	}

	// last case is three basic segments

	var td1; //duration of first and third segments
	var tdm; //duration of the middle segment
	td1 = 0.5 * jPct * (tf - t0);
	tdm = tf - t0 - 2 * (td1);

	//calculate max accel by dividing the segment into three chunks
	// and using the fact that (vf-v0) equals area under acceleration
	aMax = (vf - v0) / (td1 + tdm);
	jerk = aMax / td1;

	coeffs1 = [jerk / 6, 0, v0, p0];
	basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + td1, coeffs1);

	coeffs2 = [0, aMax / 2, basicSegment.evaluateVelocityAt(t0 + td1), basicSegment.evaluatePositionAt(t0 + td1)]; // middle segment has no jerk

	basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + td1, t0 + td1 + tdm, coeffs2);

	coeffs3 = [-jerk / 6, aMax / 2, basicSegment2.evaluateVelocityAt(t0 + td1 + tdm), basicSegment2.evaluatePositionAt(t0 + td1 + tdm)];
	basicSegment3 = basicSegmentFactory.CreateBasicSegment(t0 + td1 + tdm, tf, coeffs3);


	return [basicSegment, basicSegment2, basicSegment3];
};


/**
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * Modification takes into account absolute vs incremental mode
 * @param {float} t0 new initial time
 * @param {float} a0 new initial acceleration
 * @param {float} v0 new initial velocity
 * @param {float} p0 new initial position
 */
AccelSegmentTimeVelocity.prototype.modifyInitialValues = function(t0, a0, v0, p0) {

	var tf, vf;

	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		vf = v0 + this.segmentData.finalVelocity - this.segmentData.initialVelocity;
	} else {
		tf = this.segmentData.finalTime;
		this.segmentData.duration = tf - t0;
		vf = this.segmentData.finalVelocity;
		if (fastMath.lt(this.segmentData.duration, 0))
			throw new Error('tried to move initial time past final time for absolute segment');
	}

	var newBasicSegments = this.calculateBasicSegments(t0, tf, p0, v0, vf, this.segmentData.jerkPercent);

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
AccelSegmentTimeVelocity.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {

	if (newSegmentData.mode !== "absolute")
		newSegmentData.mode = "incremental";

	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.initialVelocity = newSegmentData.initialVelocity || this.segmentData.initialVelocity;
	this.segmentData.finalVelocity = newSegmentData.finalVelocity || this.segmentData.finalVelocity;
	this.segmentData.duration = newSegmentData.duration || this.segmentData.duration;
	this.segmentData.jerkPercent = newSegmentData.jerkPercent || this.segmentData.jerkPercent;
	this.segmentData.loads = {};
	Util.extend(this.segmentData.loads, newSegmentData.loads);

	this.finalTime = this.initialTime + this.segmentData.duration;

	var newBasicSegments = this.calculateBasicSegments(this.initialTime,
		this.finalTime,
		initialConditions.position,
		initialConditions.velocity,
		this.segmentData.finalVelocity,
		this.segmentData.jerkPercent
	);

	this.segments.initializeWithSegments(newBasicSegments);

	this.setBasicSegmentLoads(newSegmentData.loads);
	return this;
};


/**
 * Acceleration segment that is based on time and distance.
 * When initial conditions change, it is recalculated such that the duration and final position stay the same
 * @param {Number} t0   initial time
 * @param {Number} tf   final time
 * @param {Number} p0   initial position
 * @param {Number} v0   initial velocity
 * @param {Number} pf   final position
 * @param {Number} jPct percent jerk
 * @param {string} mode absolute or incremental
 */
var AccelSegmentTimeDistance = function(t0, tf, p0, v0, pf, jPct, mode, loads) {
	if (arguments.length <= 7)
		throw new Error("Expected at least 7 arguments in AccelSegmentTimeDistance constructor");

	if (mode !== "absolute")
		mode = "incremental";


	var loads_copy = {};
	Util.extend(loads_copy, loads);

	//incremental and absolute segments are instantiated the same way
	this.segmentData = {
		dataPermutation: "time-distance",
		finalPosition: pf,
		finalTime: tf,
		distance: pf - p0,
		duration: tf - t0,
		mode: mode,
		jerkPercent: jPct,
		loads: loads_copy
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, v0, pf, jPct);

	AccelMotionSegment.call(this, basicSegments);
	this.setBasicSegmentLoads(loads);
};

AccelSegmentTimeDistance.prototype = Object.create(AccelMotionSegment.prototype);
AccelSegmentTimeDistance.prototype.constructor = AccelSegmentTimeDistance;

/**
 * Calculates and creates the 1 to 3 basic segments that AccelSegment consists of
 * @param  {Number} t0   initial time
 * @param  {Number} tf   finalt time
 * @param  {Number} p0   initial position
 * @param  {Number} v0   initial velocity
 * @param  {Number} vf   final velocity
 * @param  {Number} jPct jerk percentage
 * @return {Array}      Array of BasicSegment
 */
AccelSegmentTimeDistance.prototype.calculateBasicSegments = function(t0, tf, p0, v0, pf, jPct) {
	var basicSegment, basicSegment2, basicSegment3;
	var accelSegment, aMax;
	var coeffs, coeffs1, coeffs2, coeffs3, coeffs4;
	var jerk;
	var th;
	if (jPct === 0) {
		// consists of one basic segment
		aMax = (2 * (pf - p0)) / fastMath.sqr(tf - t0);
		coeffs = [0, 0.5 * aMax, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, tf, coeffs);

		return [basicSegment];
	}

	//function to calculate max acceleration for this segment
	var maxAccel = function(v0) {

		var duration = this.segmentData.duration;

		var t1 = 0.5 * this.segmentData.jerkPercent * (duration);
		var tm = duration - 2 * (t1);
		var t2 = t1; //no skew for now

		var sqr = fastMath.sqr;


		var numerator = this.segmentData.distance - v0 * (duration);

		var denominator = sqr(t1) / 6 + 0.5 * t1 * tm + 0.5 * sqr(tm) + 0.5 * t1 * t2 + tm * t2 + sqr(t2) / 3;

		var aMax = numerator / denominator;

		return aMax;

	};


	aMax = maxAccel.call(this, v0);

	if (jPct == 1) {
		// two basic segments

		jerk = aMax / th;

		coeffs1 = [jerk / 6, 0, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + th, coeffs1);

		coeffs2 = [basicSegment.evaluatePositionAt(t0 + th), basicSegment.evaluateVelocityAt(t0 + th), aMax / 2, -jerk / 6];

		basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + th, tf, coeffs2);

		return [basicSegment, basicSegment2];
	}

	// last case is three basic segments

	var td1; //duration of first and third segments
	var tdm; //duration of the middle segment
	td1 = 0.5 * jPct * (tf - t0);
	tdm = tf - t0 - 2 * (td1);

	jerk = aMax / td1;

	coeffs1 = [jerk / 6, 0, v0, p0];
	basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + td1, coeffs1);

	coeffs2 = [0, aMax / 2, basicSegment.evaluateVelocityAt(t0 + td1), basicSegment.evaluatePositionAt(t0 + td1)]; // middle segment has no jerk
	basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + td1, t0 + td1 + tdm, coeffs2);

	coeffs3 = [-jerk / 6, aMax / 2, basicSegment2.evaluateVelocityAt(t0 + td1 + tdm), basicSegment2.evaluatePositionAt(t0 + td1 + tdm)];
	basicSegment3 = basicSegmentFactory.CreateBasicSegment(t0 + td1 + tdm, tf, coeffs3);


	return [basicSegment, basicSegment2, basicSegment3];
};


/**
 * Modifies segment initial values. Used when adding a point in the middle of a segment.
 * @param {float} t0 new initial time
 * @param {float} a0 new initial acceleration
 * @param {float} v0 new initial velocity
 * @param {float} p0 new initial position
 */
AccelSegmentTimeDistance.prototype.modifyInitialValues = function(t0, a0, v0, p0) {

	var tf, pf;

	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.distance;
	} else {
		//absolute mode
		tf = this.segmentData.finalTime;
		this.segmentData.duration = tf - t0;
		pf = this.segmentData.finalPosition;
		this.segmentData.distance = pf - p0;
		if (fastMath.lt(this.segmentData.duration, 0))
			throw new Error("attempt to change initial time past final time for absolute segment");
	}

	var newBasicSegments = this.calculateBasicSegments(t0, tf, p0, v0, pf, this.segmentData.jerkPercent);

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
AccelSegmentTimeDistance.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {


	if (newSegmentData.mode !== "absolute")
		newSegmentData.mode = "incremental";


	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.distance = newSegmentData.distance || this.segmentData.distance;
	this.segmentData.duration = newSegmentData.duration || this.segmentData.duration;
	this.segmentData.jerkPercent = newSegmentData.jerkPercent || this.segmentData.jerkPercent;

	this.finalTime = this.initialTime + this.segmentData.duration;

	this.segmentData.loads = {};
	Util.extend(this.segmentData.loads, newSegmentData.loads);

	var newBasicSegments = this.calculateBasicSegments(this.initialTime,
		this.finalTime,
		initialConditions.position,
		initialConditions.velocity,
		initialConditions.position + this.segmentData.distance,
		this.segmentData.jerkPercent
	);

	this.segments.initializeWithSegments(newBasicSegments);
	this.setBasicSegmentLoads(newSegmentData.loads);

	return this;


};



/**
 * Makes a new AccelMotionSegment given velocity information
 * @param {number} t0 [initial time]
 * @param {number} tf [final time]
 * @param {number} p0 [initial position]
 * @param {number} v0 [final position]
 * @param {number} vf [final velocity]
 * @param {number} jPct  [jerk as a percent of time]
 * @param {string} mode incremental or absolute
 * @returns {AccelMotionSegment} [freshly created accel segment]
 */
factory.MakeFromTimeVelocity = function(t0, tf, p0, v0, vf, jPct, mode, loads) {

	if (Util.isUndefined(jPct) || jPct < 0 || jPct > 1)
		throw new Error('expecting jerk between <0,1>');

	var accelSegment = new AccelSegmentTimeVelocity(t0, tf, p0, v0, vf, jPct, mode, loads);

	return accelSegment;

};

/**
 * Makes a new AccelMotionSegment given velocity information
 * @param {Number} t0 [initial time]
 * @param {Number} tf [final time]
 * @param {Number} p0 [initial position]
 * @param {Number} v0 [final position]
 * @param {Number} pf final velocity
 * @param {Number} jPct  [jerk as a percent of time]
 * @returns {AccelMotionSegment} [freshly created accel segment]
 */
factory.MakeFromTimeDistance = function(t0, tf, p0, v0, pf, jPct, mode, loads) {

	if (Util.isUndefined(jPct) || jPct < 0 || jPct > 1)
		throw new Error('expecting jerk between <0,1>');
	//TODO: more parameter checks

	var accelSegment = new AccelSegmentTimeDistance(t0, tf, p0, v0, pf, jPct, mode, loads);

	return accelSegment;


};

factory.calculateTimeVelocityBasicSegments = AccelSegmentTimeVelocity.prototype.calculateBasicSegments;


factory.AccelMotionSegment = AccelMotionSegment;

module.exports = factory;