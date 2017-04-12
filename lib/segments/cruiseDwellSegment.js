var MotionSegment = require('./motionSegment');
var basicSegmentFactory = require('./basicSegment');
var Util = require('../util/util');
var FastMath=require('../util/fastMath');

var factory = {};

/**
 * Cruise dwell motion segment constructor functions
 * @param {Object} data contains data gathered from the user
 * @param {Object} loads describes segment loads
 */
var CruiseDwellMotionSegment = function(data, loads) {
	"use strict";

	this.type = 'cruiseDwell';
	this.initialTime = data.initialTime;
	this.finalTime = data.finalTime;

	this.segmentData = {
		initialTime: data.initialTime,
		finalTime: data.finalTime,
		velocity: data.velocity,
		initialPosition: data.initialPosition,
		finalPosition: data.finalPosition,
		duration: data.finalTime-data.initialTime,
		distance: data.finalPosition-data.initialPosition,
		permutation: data.permutation,
		mode: data.mode,
	};

	MotionSegment.MotionSegment.call(this, this.segmentData.initialTime, this.segmentData.finalTime);
	this.setBasicSegmentLoads(loads);

	if(FastMath.gt(this.segmentData.distance,0) && FastMath.equal(this.segmentData.velocity, 0))
		throw new Error("Unable to create a cruise/dwell segment with zero initial velocity and non zero distance");

	var basicSegment = this.calculateBasicSegment(
		this.segmentData.initialTime,
		this.segmentData.finalTime,
		this.segmentData.initialPosition,
		this.segmentData.finalPosition,
		this.segmentData.velocity
	);

	this.segments.initializeWithSegments(basicSegment);
};

CruiseDwellMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
CruiseDwellMotionSegment.prototype.constructor = CruiseDwellMotionSegment;

/**
 * Modifies initial values with a new start point
 * @param  {MotionPoint} startPoint describes new initial conditions
 * @return {CruiseDwellSegment}            current segment
 */
CruiseDwellMotionSegment.prototype.modifyInitialValues = function(startPoint) {
	var t0 = startPoint.time;
	var v0 = startPoint.velocity;
	var p0 = startPoint.position;

	console.log(JSON.stringify(startPoint));

	this.segmentData.velocity = v0;

	if (this.segmentData.permutation == 'distance') {
		if (this.segmentData.mode == 'incremental') {
			this.segmentData.initialPosition = p0;
			this.segmentData.finalPosition = p0 + this.segmentData.distance;
		} else if (this.segmentData.mode == 'absolute') {
			this.segmentData.initialPosition = p0;
			this.segmentData.distance = this.segmentData.finalPosition - p0;
		}

		this.segmentData.initialTime = t0;
		if (FastMath.equal(this.segmentData.velocity, 0)) {
			throw new Error('Cannot have permutation distance and 0 velocity');
		}
		this.segmentData.finalTime = this.segmentData.distance/this.segmentData.velocity;
		this.segmentData.duration = this.segmentData.finalTime - this.segmentData.initialTime;
	} else if (this.segmentData.permutation == 'time') {
		this.segmentData.initialTime = t0;
		if (this.segmentData.mode == 'incremental') {
			this.segmentData.finalTime = t0 + this.segmentData.duration;
		} else if (this.segmentData.mode == 'absolute') {
			this.segmentData.duration = this.segmentData.finalTime - t0;
		}

		this.segmentData.initialPosition = p0;
		this.segmentData.finalPosition = this.segmentData.velocity*this.segmentData.duration;
		this.segmentData.distance = this.segmentData.finalPosition - this.segmentData.initialPosition;
	}

	var newBasicSegment = this.calculateBasicSegment(
		this.segmentData.initialTime,
		this.segmentData.finalTime,
		this.segmentData.initialPosition,
		this.segmentData.finalPosition,
		this.segmentData.velocity
	);

	this.segments.initializeWithSegments(newBasicSegment);

	return this;
};


CruiseDwellMotionSegment.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {
	if (newSegmentData.mode == 'absolute' || newSegmentData.mode == 'incremental') {
		this.segmentData.mode = newSegmentData.mode;
	}

	this.segmentData.initialTime = initialConditions.time || this.segmentData.initialTime;
	this.segmentData.initialPosition = initialConditions.position || this.segmentData.initialPosition;
	this.segmentData.permutation = newSegmentData.permutation || this.segmentData.permutation;
	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.velocity = initialConditions.velocity || this.segmentData.velocity;

	if (this.segmentData.mode == 'incremental') {
		this.segmentData.distance = newSegmentData.distance || this.segmentData.distance;
		this.segmentData.duration = newSegmentData.duration || this.segmentData.duration;

		this.segmentData.finalTime = this.segmentData.initialTime + this.segmentData.duration;
		this.segmentData.finalPosition = this.segmentData.initialPosition + this.segmentData.distance;
	} else if (this.segmentData.mode == 'absolute') {
		this.segmentData.finalTime = newSegmentData.finalTime || this.segmentData.finalTime;
		this.segmentData.finalPosition = newSegmentData.finalPosition || this.segmentData.finalPosition;

		this.segmentData.duration = this.segmentData.finalTime - this.segmentData.initialTime;
		this.segmentData.distance = this.segmentData.finalPosition - this.segmentData.initialPosition
	}

	this.initialTime = this.segmentData.initialTime;
	this.finalTime = this.segmentData.finalTime;

	var newLoads = {};
	Util.extend(newLoads, this.segmentData.loads);
	Util.extend(newLoads, newSegmentData.loads);

	var newbasicSegment = this.calculateBasicSegment(
		initialConditions.time,
		this.segmentData.finalTime,
		initialConditions.position,
		this.segmentData.finalPosition,
		this.segmentData.velocity
	);

	this.initializeWithSegments(newbasicSegment);
	this.setBasicSegmentLoads(newLoads);

	return this;
};


CruiseDwellMotionSegment.prototype.calculateBasicSegment = function (t0, tf, p0, pf, v) {
	return [basicSegmentFactory.CreateBasicSegment(t0, tf, [0, 0, v, p0])];
};

factory.CruiseDwellMotionSegment = CruiseDwellMotionSegment;


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
factory.Make = function(t0, tf, p0, v0, pf, permutation, mode, loads){
	if (tf < t0)
		throw new Error('expecting tf to come after t0');

	//default to incremental and distance
	mode = mode == 'incremental' ? 'incremental' : 'absolute';
	permutation = permutation == 'time' ? 'time' : 'distance';

	var cruiseDwellSegment =  new CruiseDwellMotionSegment({
		initialTime: t0,
		finalTime: tf,
		initialPosition: p0,
		finalPosition: pf,
		velocity: v0,
		permutation: permutation,
		mode: mode
	}, loads);

	return cruiseDwellSegment;
};

factory.CruiseDwellMotionSegment = CruiseDwellMotionSegment;

module.exports = factory;