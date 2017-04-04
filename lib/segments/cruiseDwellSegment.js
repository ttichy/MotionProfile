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

	var segmentData={};


	var distance;

	// cruise dwell has one basicSegment
	var basicSegment;


	segmentData.mode=constructorData.mode;
	segmentData.initialVelocity=constructorData.initialVelocity;
	segmentData.initialTime=constructorData.initialTime;
	segmentData.finalTime=constructorData.finalTime;

	if(constructorData.permutation==='distance')
	{
		segmentData.permutation='distance';
		segmentData.distance=constructorData.finalPosition-constructorData.initialPosition;
		distance=segmentData.distance;

	}
	else {
		segmentData.permutation='time';
		segmentData.duration=constructorData.finalTime-constructorData.initialTime;
		distance=(segmentData.finalTime-segmentData.initialTime) * segmentData.initialVelocity;

	}


	if(FastMath.gt(distance,0) && FastMath.equal(segmentData.initialVelocity,0))
		throw new Error("Unable to create a cruise/dwell segment with zero initial velocity and non zero distance");


	//create an accel segment with same initial and final velocity
	basicSegment=AccelSegment.MakeFromTimeVelocity(segmentData.initialTime,
		segmentData.finalTime,
		constructorData.initialPosition,
		segmentData.initialVelocity,
		segmentData.initialVelocity,
		0,
		segmentData.mode,
		loads);


	this.type = 'cruiseDwell';

	AccelSegment.AccelMotionSegment.call(this, [basicSegment]);
	this.setBasicSegmentLoads(loads);

};



CruiseDwellMotionSegment.prototype = Object.create(AccelSegment.AccelSegmentTimeVelocity.prototype);
CruiseDwellMotionSegment.prototype.constructor = CruiseDwellMotionSegment;



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
factory.make = function(t0,tf,p0,v0,pf, permutation, mode,loads){
	if (arguments.length <6)
		throw new Error("Expected at least 5 arguments to create Cruise/Dwell segment");

	//default to incremental
	if(mode !=='incremental')
		mode='absolute';

	if(permutation !== 'time')
		permutation='distance';

	return new CruiseDwellMotionSegment({
		initialTime: t0,
		finalTime: tf,
		initialPosition: p0,
		finalPosition: pf,
		initialVelocity: v0,
		permutation: permutation,
		mode: mode
	}, loads);

};


factory.CruiseDwellMotionSegment = CruiseDwellMotionSegment;

module.exports = factory;