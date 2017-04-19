var MotionSegment = require('./motionSegment');
var basicSegmentFactory = require('./basicSegment');
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


/**
 * Gets pertinenta data to be able to serialize/deserilize segment
 * @return {object} data representation of the segment
 */
AccelMotionSegment.prototype.exportData = function() {

	var dataObj=MotionSegment.MotionSegment.prototype.exportData.call(this);

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
			return new AccelSegmentTimeVelocity(
				data.initialTime,
				data.finalTime,
				data.initialPosition,
				data.initialVelocity,
				data.finalVelocity,
				data.jerkPercent,
				data.mode,
				data.loads
			);

		case "AccelSegmentTimeDistance":
			return new AccelSegmentTimeDistance(
				data.initialTime,
				data.finalTime,
				data.initialPosition,
				data.initialVelocity,
				data.distance,
				data.jerkPercent,
				data.mode,
				data.loads
			);

		default:
			throw new Error("Unkown AccelSegment type: " + data.constructor);
	}
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
		initialPosition: p0,
		initialVelocity: v0,
		finalVelocity: vf,
		duration: tf - t0,
		acceleration: vf - v0,
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

		// coeffs2 = [basicSegment.evaluatePositionAt(t0 + th), basicSegment.evaluateVelocityAt(t0 + th), aMax / 2, -jerk / 6];
		coeffs2 = [-jerk / 6,  aMax / 2, basicSegment.evaluateVelocityAt(t0 + th), basicSegment.evaluatePositionAt(t0 + th)];

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
 * @param {MotionPoint} startPoint position/velocity/accel/jerk definition
 */
AccelSegmentTimeVelocity.prototype.modifyInitialValues = function(startPoint) {

	var tf, vf;
	var t0 = startPoint.time;
	var a0 = startPoint.acceleration;
	var v0 = startPoint.velocity;
	var p0 = startPoint.position;

	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		vf = v0 + this.segmentData.acceleration;
	} else {
		tf = this.segmentData.finalTime;
		vf = this.segmentData.finalVelocity;
		this.segmentData.duration = tf - t0;
		this.segmentData.acceleration = vf-v0;
		if (fastMath.leq(this.segmentData.duration, 0))
			throw new Error("Attempt to change final time to/before initial time for absolute segment");
	}

	this.segmentData.initialVelocity = v0;
	this.segmentData.initialPosition = p0;
	this.segmentData.initialTime = t0;
	this.segmentData.finalTime = tf;
	this.segmentData.finalVelocity = vf;

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
	// set mode first
	if (newSegmentData.mode == 'absolute' || newSegmentData.mode == 'incremental') {
		this.segmentData.mode = newSegmentData.mode;
	}

	// based on mode, update values
	if (this.segmentData.mode == 'incremental') {
		this.segmentData.acceleration = (newSegmentData.acceleration || newSegmentData.acceleration == 0) ? newSegmentData.acceleration : this.segmentData.acceleration;
		this.segmentData.duration = (newSegmentData.duration || newSegmentData.duration == 0) ? newSegmentData.duration : this.segmentData.duration;
		this.segmentData.jerkPercent = (newSegmentData.jerkPercent || newSegmentData.jerkPercent == 0) ? newSegmentData.jerkPercent : this.segmentData.jerkPercent;

		this.segmentData.finalTime = initialConditions.time + this.segmentData.duration;
		this.segmentData.finalVelocity = initialConditions.velocity + this.segmentData.acceleration;
	} else if (this.segmentData.mode == 'absolute') {
		this.segmentData.finalPosition = (newSegmentData.finalPosition || newSegmentData.finalPosition == 0) ? newSegmentData.finalPosition : this.segmentData.finalPosition;
		this.segmentData.finalTime = (newSegmentData.finalTime || newSegmentData.finalTime == 0) ? newSegmentData.finalTime : this.segmentData.finalTime;
		this.segmentData.jerkPercent = (newSegmentData.jerkPercent || newSegmentData.jerkPercent == 0) ? newSegmentData.jerkPercent : this.segmentData.jerkPercent;

		this.segmentData.acceleration = this.segmentData.finalVelocity - initialConditions.velocity;
		this.segmentData.duration = this.segmentData.finalTime - initialConditions.time;
	}
	// update data structure in preparation for recalculating basic segments

	var newLoads = {};
	Util.extend(newLoads, this.segmentData.loads);
	Util.extend(newLoads, newSegmentData.loads);

	// since final time exists as a property of both segmentData and the AccelSegmentTimeDistance object, we need to update the latter here
	this.initialTime = initialConditions.time;
	this.finalTime = this.segmentData.finalTime;

	if (newSegmentData.dataPermutation && newSegmentData.dataPermutation !== 'time-velocity') {
		switch (newSegmentData.dataPermutation) {
			case 'time-distance':
				var newAccSeg =  new AccelSegmentTimeDistance(
					this.segmentData.initialTime,
					this.segmentData.finalTime,
					this.segmentData.initialVelocity,
					this.segmentData.initialPosition,
					this.evaluatePositionAt(this.segmentData.finalTime),
					this.segmentData.jerkPercent,
					this.segmentData.mode,
					this.segmentData.loads
				);
				// newAccSeg.id = this.id;
				return newAccSeg;

			default:
				throw new Error('Invalid Data Permutation: ' + newSegmentData.dataPermutation);
		}
	}

	var newBasicSegments = this.calculateBasicSegments(initialConditions.time,
		this.segmentData.finalTime,
		initialConditions.position,
		initialConditions.velocity,
		this.segmentData.finalVelocity,
		this.segmentData.jerkPercent
	);

	this.segments.initializeWithSegments(newBasicSegments);
	this.setBasicSegmentLoads(newLoads);

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
		initialTime: t0,
		finalTime: tf,
		initialVelocity: v0,
		initialPosition: p0,
		dataPermutation: "time-distance",
		finalPosition: pf,
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

		var duration = tf-t0;

		var t1 = 0.5 * this.segmentData.jerkPercent * (duration);
		var tm = duration - 2 * (t1);
		var t2 = t1; //no skew for now

		var sqr = fastMath.sqr;


		var numerator = (pf-p0) - v0 * (duration);

		var denominator = sqr(t1) / 6 + 0.5 * t1 * tm + 0.5 * sqr(tm) + 0.5 * t1 * t2 + tm * t2 + sqr(t2) / 3;

		var aMax = numerator / denominator;

		return aMax;

	};


	aMax = maxAccel.call(this, v0);

	if (jPct == 1) {
		// two basic segments

		th = (tf-t0)/2;

		jerk = aMax/th;

		coeffs1 = [jerk/6, 0, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0+th, coeffs1);

		coeffs2 = [-jerk/6, aMax/2, basicSegment.evaluateVelocityAt(t0+th), basicSegment.evaluatePositionAt(t0+th)];

		basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0+th, tf, coeffs2);

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
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * Modification takes into account absolute vs incremental mode
 * @param {MotionPoint} startPoint position/velocity/accel/jerk definition
 */
AccelSegmentTimeDistance.prototype.modifyInitialValues = function(startPoint) {

	var tf, pf;
	var t0 = startPoint.time;
	var a0 = startPoint.acceleration;
	var v0 = startPoint.velocity;
	var p0 = startPoint.position;

	if (this.segmentData.mode === 'incremental') {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.distance;
	} else if (this.segmentData.mode == 'absolute') {
		//absolute mode
		tf = this.segmentData.finalTime;
		pf = this.segmentData.finalPosition;
		this.segmentData.distance = pf - p0;
		this.segmentData.duration = tf - t0;
		if (fastMath.leq(this.segmentData.duration, 0))
			throw new Error("Attempt to change final time to/before initial time for absolute segment");
	}

	this.segmentData.initialVelocity = v0;
	this.segmentData.initialPostiion = p0;
	this.segmentData.initialTime = t0;
	this.segmentData.finalTime = tf;
	this.segmentData.finalPosition = pf;

	var newBasicSegments = this.calculateBasicSegments(t0, tf, p0, v0, pf, this.segmentData.jerkPercent);

	this.initialTime = newBasicSegments[0].initialTime;
	this.finalTime = newBasicSegments[newBasicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};


/**
 * Edit user entered segment values
 * @param  {Object} newSegmentData      new user entered data
 * @param {Object} initialConditions	object of initial conditions
 */
AccelSegmentTimeDistance.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {
	// set mode first
	if (newSegmentData.mode == 'absolute' || newSegmentData.mode == 'incremental') {
		this.segmentData.mode = newSegmentData.mode;
	}

	// based on mode, update values
	if (this.segmentData.mode == 'incremental') {
		this.segmentData.distance = (newSegmentData.distance || newSegmentData.distance == 0) ? newSegmentData.distance : this.segmentData.distance;
		this.segmentData.duration = (newSegmentData.duration || newSegmentData.duration == 0) ? newSegmentData.duration : this.segmentData.duration;
		this.segmentData.jerkPercent = (newSegmentData.jerkPercent || newSegmentData.jerkPercent == 0) ? newSegmentData.jerkPercent : this.segmentData.jerkPercent;

		this.segmentData.finalTime = initialConditions.time + this.segmentData.duration;
		this.segmentData.finalPosition = initialConditions.position + this.segmentData.distance;
	} else if (this.segmentData.mode == 'absolute') {
		this.segmentData.finalPosition = (newSegmentData.finalPosition || newSegmentData.finalPosition == 0) ? newSegmentData.finalPosition : this.segmentData.finalPosition;
		this.segmentData.finalTime = (newSegmentData.finalTime || newSegmentData.finalTime == 0) ? newSegmentData.finalTime : this.segmentData.finalTime;
		this.segmentData.jerkPercent = (newSegmentData.jerkPercent || newSegmentData.jerkPercent == 0) ? newSegmentData.jerkPercent : this.segmentData.jerkPercent;

		this.segmentData.distance = this.segmentData.finalPosition - initialConditions.position;
		this.segmentData.duration = this.segmentData.finalTime - initialConditions.time;
	}
	// update data structure in preparation for recalculating basic segments
	// this.segmentData.dataPermutation = newSegmentData.dataPermutation || this.segmentData.dataPermutation; // not this one
	// this.segmentData.loads = newSegmentData.loads || this.segmentData.loads; // handle this special

	var newLoads = {};
	Util.extend(newLoads, this.segmentData.loads);
	Util.extend(newLoads, newSegmentData.loads);
	this.segmentData.loads = newLoads;

	// since final time exists as a property of both segmentData and the AccelSegmentTimeDistance object, we need to update the latter here
	this.initialTime = initialConditions.time;
	this.finalTime = this.segmentData.finalTime;

	if (newSegmentData.dataPermutation && newSegmentData.dataPermutation !== 'time-distance') {
		switch (newSegmentData.dataPermutation) {
			case 'time-velocity':
				var newAccSeg =  new AccelSegmentTimeVelocity(
					initialConditions.time,
					this.segmentData.finalTime,
					initialConditions.position,
					initialConditions.velocity,
					this.evaluateVelocityAt(this.segmentData.finalTime),
					this.segmentData.jerkPercent,
					this.segmentData.mode,
					this.segmentData.loads
				);
				// newAccSeg.id = this.id;
				return newAccSeg;

			default:
				throw new Error('Invalid Data Permutation');
		}
	}

	var newBasicSegments = this.calculateBasicSegments(initialConditions.time,
		this.segmentData.finalTime,
		initialConditions.position,
		initialConditions.velocity,
		this.segmentData.finalPosition,
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
factory.AccelSegmentTimeVelocity = AccelSegmentTimeVelocity;

module.exports = factory;