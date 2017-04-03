var AccelSegment = require('./accelSegment');
var Util = require('../util/util');

var factory = {};

/**
 * Cruise dwell motion segment
 * @param {Object} constructorData contains data gathered from the user
 * @param {Object} loads describes segment loads
 */
var CruiseDwellMotionSegment = function(constructorData,loads) {

	var segmentData={};


	var distance;

	// cruise dwell has one basicSegment
	var basicSegment = 


	segmentData.mode=constructorData.mode;
	segmentData.initialVelocity=constructorData.initialVelocity;
	segmentData.initialTime=constructorData.initialTime;
	segmentData.finalTime=constructorData.finalTime;

	if(constructorData.distance)
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




factory.makeWithDistance = function(t0,tf,p0,v0,pf, mode,loads){


	return new CruiseDwellMotionSegment({
		initialTime: t0,
		finalTime: tf,
		initialPosition: p0,
		finalPosition: pf,
		initialVelocity: v0,
		mode: mode
	}, loads);

};

factory.CruiseDwellMotionSegment = CruiseDwellMotionSegment;

module.exports = factory;