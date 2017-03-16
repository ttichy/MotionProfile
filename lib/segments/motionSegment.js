var fastMath = require('../util/fastMath');
var SegmentStash = require('./segmentStash');
var Segment = require('./segment');
var Util = require('../util/util');


/**
 * MotionSegment is a collection of other MotionSegments. MotionSegment(s) form the entire MotionProfile
 * Initialize the segment with a unique id and a stash to hold other segments
 * @param {Number} t0 initial Time
 * @param {Number} tf final Time
 */
var MotionSegment = function(t0, tf) {


	Segment.Segment.call(this, t0, tf);

	//each segment can hold other segments
	this.segments = SegmentStash.makeStash();

};


MotionSegment.prototype = Object.create(Segment.Segment.prototype);
MotionSegment.prototype.constructor = MotionSegment;



MotionSegment.prototype.initializeWithSegments = function(segments) {

	if (!Array.isArray(segments))
		throw new Error("Expecting array of segments. Was not an array");

	//add each segment
	for (var i = 0; i < segments.length; i++) {
		this.segments.insertAt(segments[i], null);
	}
};


MotionSegment.prototype.FindSegmentAtTime = function(time) {
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


MotionSegment.prototype.evaluatePositionAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	if(segment.type !== "basic")
		return segment.evaluatePositionAt(x);
	else
		return segment.positionPoly.evaluateAt(x);

};

MotionSegment.prototype.evaluateVelocityAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	if(segment.type !== "basic")	
		return segment.evaluateVelocityAt(x);
	else
		return segment.velocityPoly.evaluateAt(x);
};

MotionSegment.prototype.evaluateAccelerationAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	if(segment.type !=="basic")
		return segment.evaluateAccelerationAt(x);
	else
		return segment.accelPoly.evaluateAt(x);
};


MotionSegment.prototype.evaluateJerkAt = function(x) {
	//which segment does x fall in

	var segment = this.FindSegmentAtTime(x);
	if(segment.type !=="basic")
		return segment.evaluateJerkAt(x);
	else
		return segment.jerkPoly.evaluateAt(x);
};


MotionSegment.prototype.getAllSegments = function() {
	return this.segments.getAllSegments();
};

var factory = {};

factory.MotionSegment = MotionSegment;

module.exports = factory;