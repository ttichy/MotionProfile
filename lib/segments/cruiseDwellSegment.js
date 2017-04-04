var MotionSegment = require('./motionSegment');
var BasicSegmentFactory = require('./basicSegment');
var Util = require('../util/util');
var FastMath = require('../util/fastMath');

var factory = {};

/**
 * Cruise dwell motion segment constructor functions
 * @param {Object} constructorData contains data gathered from the user
 * @param {Object} loads describes segment loads
 */
var CruiseDwellMotionSegment = function(basicSegment) {
	if (basicSegment.length > 1)
		throw new Error('Expecting aray length to be 1');

	var t0 = basicSegment.initialTime;
	var tf = basicSegment.finalTime;

	MotionSegment.MotionSegment.call(this, t0, tf);

	this.type = 'cruiseDwell';

	// each segment (regardless of type) has initialTime and finalTime
	this.initialTime = basicSegment.initialTime;
	this.finalTime = basicSegment.finalTime;
	this.segments.initializeWithSegments(basicSegment);
};

CruiseDwellMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
CruiseDwellMotionSegment.prototype.constructor = CruiseDwellMotionSegment;

CruiseDwellMotionSegment.prototype.exportData = function () {
	// need to define
};

CruiseDwellMotionSegment.prototype.importFromData = function () {
	// need to define
};

var CruiseDwellSegment = function(t0, tf, p0, v, pf, permutation, mode, loads) {
	mode = mode == 'incremental' ? 'incremental' : 'absolute';
	permutation = permutation == 'time' ? 'time' : 'distance';

	if (FastMath.equal(pf-p0, 0) && permutation == 'distance') {
		throw new Error('You cannot create a cruise/dwell segment with no position change and permutation distance. Must use permutation time.');
	}

	if (permutation == 'time') {
		pf = v*(tf-t0);
	} else {
		tf = v/(pf-p0);
	}

	if(FastMath.notEqual(pf-p0,0) && FastMath.equal(v,0))
		throw new Error("Unable to create a cruise/dwell segment with zero initial velocity and non zero distance");

	var loads_copy = {};
	Util.extend(loads_copy, loads);

	this.segmentData = {
		initialTime: t0,
		finalTime: tf,
		duration: tf - t0,
		initialVelocity: v,
		finalVelocity: v,
		initialPosition: p0,
		finalPosition: pf,
		distance: pf-p0,
		permutation: permutation,
		mode: mode,
		loads: loads_copy
	};

	var basicSegment = this.calculateBasicSegments(t0, tf, p0, v);

	CruiseDwellMotionSegment.call(this, basicSegment);
	this.setBasicSegmentLoads(loads_copy);
};


CruiseDwellSegment.prototype = Object.create(CruiseDwellMotionSegment.prototype);
CruiseDwellSegment.prototype.constructor = CruiseDwellSegment;


CruiseDwellSegment.prototype.calculateBasicSegments = function(t0, tf, p0, v) {
	var coeffs = [0, 0, v, p0];
	var basicSegment = BasicSegmentFactory.CreateBasicSegment(t0, tf, coeffs);
	return [basicSegment];
};


CruiseDwellSegment.modifyInitialValues = function(t0, a0, v0, p0) {
	var tf, pf;
	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.distance;
	} else {
		tf = this.segmentData.finalTime;
		pf = this.segmentData.finalPosition;
		this.segmentData.duration = tf-t0;
		this.segmentData.distance = pf-p0;
		if (FastMath.lt(this.segmentData.duration, 0)) {
			throw new Error('tried to move initial time past final time for absolute cd segment');
		}
	}

	var newBasicSegment = this.calculateBasicSegments(t0, tf, p0, v0);

	this.initialTime = newBasicSegment.initialTime;
	this.finalTime = newBasicSegment.finalTime;
	this.segments.initializeWithSegments(newBasicSegment);

	return this;
};


/**
 * Factory function to create a new cruise/dwell segment
 * @param  {Number} t0    initial time
 * @param  {Number} tf    final time
 * @param  {Number} p0    initial position
 * @param  {Number} v0    initial velocity
 * @param  {Number} pf    final position
 * @param  {string} permutation time vs distance
 * @param  {string} mode  incremental vs absolute
 * @param  {Object} loads describes segment loads
 * @return {CruiseDwellMotionSegment}       newly created Cruise/Dwell segment
 */
factory.Make = function(t0, tf, p0, v, pf, permutation, mode, loads){
	if (tf < t0)
		throw new Error('expecting tf to come after t0');

	//default to incremental and distance
	mode = mode == 'incremental' ? 'incremental' : 'absolute';
	permutation = permutation == 'time' ? 'time' : 'distance';

	var cruiseDwellSegment = new CruiseDwellSegment(t0, tf, p0, v, pf, permutation, mode, loads);

	return cruiseDwellSegment;
};

factory.CruiseDwellMotionSegment = CruiseDwellMotionSegment;

module.exports = factory;