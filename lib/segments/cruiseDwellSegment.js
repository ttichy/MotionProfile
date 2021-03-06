var MotionSegment = require('./motionSegment');
var basicSegmentFactory = require('./basicSegment');
var Util = require('../util/util');
var FastMath = require('../util/fastMath');

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

	if (data.permutation == 'time') {
		data.finalPosition = data.initialPosition + data.velocity * (data.finalTime - data.initialTime);
	} else if (data.permutation == 'distance') {
		data.finalTime = data.initialTime + (data.finalPosition - data.initialPosition)/data.velocity;
	}

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

	// if (this.segmentData.permutation == 'distance' && FastMath.lt(this.segmentData.duration, 0)) {
	// 	throw new Error("Unable to create a cruise/dwell segment with zero initial velocity and non zero distance");
	// }
	if(FastMath.notEqual(this.segmentData.distance, 0) && FastMath.equal(this.segmentData.velocity, 0))
		throw new Error("Unable to create a cruise/dwell segment with zero velocity and non zero distance");

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
 * @param  {MotionPoint}			startPoint describes new initial conditions
 * @return {CruiseDwellSegment}		current segment
 */
CruiseDwellMotionSegment.prototype.modifyInitialValues = function(startPoint) {
	var t0 = startPoint.time;
	var v0 = startPoint.velocity;
	var p0 = startPoint.position;

	this.segmentData.velocity = v0;

	if (this.segmentData.permutation == 'distance') {
		this.segmentData.initialPosition = p0;
		if (this.segmentData.mode == 'incremental') {
			this.segmentData.finalPosition = this.segmentData.initialPosition + this.segmentData.distance;
		} else if (this.segmentData.mode == 'absolute') {
			this.segmentData.distance = this.segmentData.finalPosition - this.segmentData.initialPosition;
		}

		this.segmentData.initialTime = t0;

		if(FastMath.notEqual(this.segmentData.distance,0) && FastMath.equal(this.segmentData.velocity,0))
			throw new Error("Cannot modify cruise/dwell segment because of non-zero distance and zero velocity");

		this.segmentData.duration = this.segmentData.distance/this.segmentData.velocity;
		this.segmentData.finalTime = this.segmentData.initialTime + this.segmentData.duration;

	} else if (this.segmentData.permutation == 'time') {
		this.segmentData.initialTime = t0;
		if (this.segmentData.mode == 'incremental') {
			this.segmentData.finalTime = this.segmentData.initialTime + this.segmentData.duration;
		} else if (this.segmentData.mode == 'absolute') {
			this.segmentData.duration = this.segmentData.finalTime - t0;
		}

		this.segmentData.initialPosition = p0;
		this.segmentData.distance = this.segmentData.velocity*this.segmentData.duration;
		this.segmentData.finalPosition = this.segmentData.initialPosition + this.segmentData.distance;
	}

	if (FastMath.leq(this.segmentData.duration, 0)) {
		throw new Error('Cannot have permutation distance and time <= 0');
	}

	this.initialTime = t0;
	this.finalTime = this.segmentData.finalTime;

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
	this.segmentData.mode = (newSegmentData.mode == 'absolute' || newSegmentData.mode == 'incremental') ? newSegmentData.mode : this.segmentData.mode;

	this.segmentData.initialTime = (initialConditions.time || initialConditions.time === 0) ? initialConditions.time : this.segmentData.initialTime;
	this.segmentData.initialPosition = (initialConditions.position || initialConditions.position === 0) ? initialConditions.position : this.segmentData.initialPosition;
	this.segmentData.permutation = (newSegmentData.permutation == 'time' || newSegmentData.permutation == 'distance') ? newSegmentData.permutation : this.segmentData.permutation;
	this.segmentData.velocity = (initialConditions.velocity || initialConditions.velocity === 0) ? initialConditions.velocity : this.segmentData.velocity;

	if (this.segmentData.permutation == 'distance') {
		if (this.segmentData.mode == 'incremental') {
			this.segmentData.distance = (newSegmentData.distance || newSegmentData.distance === 0) ? newSegmentData.distance : this.segmentData.distance;
			this.segmentData.finalPosition = this.segmentData.initialPosition + this.segmentData.distance;
		} else if (this.segmentData.mode == 'absolute') {
			this.segmentData.finalPosition = (newSegmentData.finalPosition || newSegmentData.finalPosition === 0) ? newSegmentData.finalPosition : this.segmentData.finalPosition;
			this.segmentData.distance = this.segmentData.finalPosition - this.segmentData.initialPosition;
		}

		this.segmentData.duration = this.segmentData.distance/this.segmentData.velocity;
		this.segmentData.finalTime = this.segmentData.initialTime + this.segmentData.duration;

		if(FastMath.notEqual(this.segmentData.distance, 0) && FastMath.equal(this.segmentData.velocity, 0))
			throw new Error("Unable to modify a cruise/dwell segment with zero velocity and non zero distance");
	} else if (this.segmentData.permutation == 'time') {
		if (this.segmentData.mode == 'incremental') {
			this.segmentData.duration = (newSegmentData.duration || newSegmentData.duration === 0) ? newSegmentData.duration : this.segmentData.duration;
			this.segmentData.finalTime = this.segmentData.initialTime + this.segmentData.duration;
		} else if (this.segmentData.mode == 'absolute') {
			this.segmentData.finalTime = (newSegmentData.finalTime || newSegmentData.finalTime === 0) ? newSegmentData.finalTime : this.segmentData.finalTime;
			this.segmentData.duration = this.segmentData.finalTime - this.segmentData.initialTime;
		}

		this.segmentData.distance = this.segmentData.velocity*this.segmentData.duration;
		this.segmentData.finalPosition = this.segmentData.initialPosition + this.segmentData.distance;
	}

	if (FastMath.leq(this.segmentData.duration, 0)) {
		throw new Error('Cannot have permutation distance and time <= 0');
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




/**
 * Gets pertinenta data to be able to serialize/deserilize segment
 * @return {object} data representation of the segment
 */
CruiseDwellMotionSegment.prototype.exportData = function() {
	var dataObj=MotionSegment.MotionSegment.prototype.exportData.call(this);

	dataObj.type = 'CruiseDwellMotionSegment';

	return dataObj;
};

/**
 * Deserialize(create) CruiseDwellMotionSegment from a json string
 * @param  {Object} data data representation of the segment (see exportData())
 * @return {CruiseDwellMotionSegment}      [description]
 */
CruiseDwellMotionSegment.prototype.importFromData = function(data) {

	if(data.constructor !== "CruiseDwellMotionSegment")
		throw new Error("Unknown constructor for CruiseDwellMotionSegment");

	return new  CruiseDwellMotionSegment(data, data.loads);

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
	if (FastMath.lt(tf,t0))
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