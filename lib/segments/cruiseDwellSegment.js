var AccelSegment = require('./accelSegment');
var Util = require('../util/util');
var FastMath=require('../util/fastMath');

var factory = {};

/**
 * Cruise dwell motion segment constructor functions
 * @param {Object} constructorData contains data gathered from the user
 * @param {Object} loads describes segment loads
 */
var CruiseDwellMotionSegment = function(constructorData,loads) {
	"use strict";

	var distance;

	// cruise dwell has one basicSegment
	var basicSegment;

	this.initialTime=constructorData.initialTime;
	this.finalTime=constructorData.finalTime;



	this.segmentData={};

	this.segmentData.mode=constructorData.mode;
	this.segmentData.initialVelocity=constructorData.initialVelocity;
	this.segmentData.initialTime=constructorData.initialTime;
	this.segmentData.finalTime=constructorData.finalTime;
	this.segmentData.permutation=constructorData.permutation;
	this.segmentData.distance=constructorData.finalPosition-constructorData.initialPosition;
	this.segmentData.duration=constructorData.finalTime-constructorData.initialTime;


	if(FastMath.gt(this.segmentData.distance,0) && FastMath.equal(this.segmentData.initialVelocity,0))
		throw new Error("Unable to create a cruise/dwell segment with zero initial velocity and non zero distance");


	//create an accel segment with same initial and final velocity
	basicSegment=AccelSegment.MakeFromTimeVelocity(this.segmentData.initialTime,
		this.segmentData.finalTime,
		constructorData.initialPosition,
		this.segmentData.initialVelocity,
		this.segmentData.initialVelocity,
		0,
		this.segmentData.mode,
		loads);


	AccelSegment.AccelMotionSegment.call(this, [basicSegment]);
	this.setBasicSegmentLoads(loads);

	this.type = 'cruiseDwell';

};



CruiseDwellMotionSegment.prototype = Object.create(AccelSegment.AccelSegmentTimeVelocity.prototype);
CruiseDwellMotionSegment.prototype.constructor = CruiseDwellMotionSegment;


/**
 * Modifies initial values with a new start point
 * @param  {MotionPoint} startPoint describes new initial conditions
 * @return {CruiseDwellSegment}            current segment
 */
CruiseDwellMotionSegment.prototype.modifyInitialValues = function(startPoint) {

	var t0=startPoint.time;
	var a0=startPoint.acceleration;
	var v0=startPoint.velocity;
	var p0=startPoint.position;

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

	var newBasicSegments = this.calculateBasicSegments(t0, tf, p0, v0,v0,0);

	this.initialTime = newBasicSegments[0].initialTime;
	this.finalTime = newBasicSegments[0].finalTime;
	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};


CruiseDwellSegment.prototype.duplicate = function () {
	// CruiseDwellSegment(t0, tf, p0, v, pf, permutation, mode, loads)
	return new CruiseDwellSegment(
		this.segmentData.initialTime,
		this.segmentData.finalTime,
		this.segmentData.initialPosition,
		this.segmentData.initialVelocity,
		this.segmentData.finalPosition,
		this.segmentData.permutation,
		this.segmentData.mode,
		this.segmentData.loads
	);
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
		initialVelocity: v0,
		permutation: permutation,
		mode: mode
	}, loads);

	return cruiseDwellSegment;
};

factory.CruiseDwellMotionSegment = CruiseDwellMotionSegment;

module.exports = factory;