var fastMath = require('../util/fastMath');
var SegmentStash = require('./segmentStash');
var Segment = require('./segment');
var Util = require('../util/util');
var MotionPoint = require('../profile/motionPoint').MotionPoint;


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

MotionSegment.prototype.exportData = function() {
	var dataObj = {};

	Util.extend(dataObj, this.segmentData);
	dataObj.constructor = this.constructor.name;

	return dataObj;
};


MotionSegment.prototype.importFromData = function(data) {
	throw new Error("importFromData() function needs to be defined on derived segments!");
};


MotionSegment.prototype.duplicate = function () {
	return this.importFromData(this.exportData());
};


MotionSegment.prototype.initializeWithSegments = function(segments) {

	if (!Array.isArray(segments))
		throw new Error("Expecting array of segments. Was not an array");

	//add each segment
	for (var i = 0; i < segments.length; i++) {
		this.segments.insertAt(segments[i], null);
	}
};


MotionSegment.prototype.findSegmentAtTime = function(time) {
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
	var segment = this.findSegmentAtTime(x);
	if(segment.type !== "basic") {
		return segment.evaluatePositionAt(x);
	} else {
		return segment.positionPoly.evaluateAt(x);
	}
};


MotionSegment.prototype.evaluateVelocityAt = function(x) {
	//which segment does x fall in
	var segment = this.findSegmentAtTime(x);
	if(segment.type !== "basic") {
		return segment.evaluateVelocityAt(x);
	} else {
		return segment.velocityPoly.evaluateAt(x);
	}
};


MotionSegment.prototype.evaluateAccelerationAt = function(x) {
	//which segment does x fall in
	var segment = this.findSegmentAtTime(x);
	if(segment.type !=="basic")
		return segment.evaluateAccelerationAt(x);
	else
		return segment.accelPoly.evaluateAt(x);
};


MotionSegment.prototype.evaluateJerkAt = function(x) {
	//which segment does x fall in

	var segment = this.findSegmentAtTime(x);
	if(segment.type !=="basic")
		return segment.evaluateJerkAt(x);
	else
		return segment.jerkPoly.evaluateAt(x);
};


MotionSegment.prototype.evaluateLoadAt = function(x) {
	//which segment does x fall in

	var segment = this.findSegmentAtTime(x);
	if(segment.type !== "basic")
		return segment.evaluateLoadAt(x);
	else
		return segment.load;
};


MotionSegment.prototype.evaluateThrustAt = function(x) {
	//which segment does x fall in

	var segment = this.findSegmentAtTime(x);
	if(segment.type !=="basic")
		return segment.evaluateThrustAt(x);
	else
		return segment.thrust;
};


MotionSegment.prototype.evaluateFrictionAt = function(x) {
	//which segment does x fall in

	var segment = this.findSegmentAtTime(x);
	if(segment.type !=="basic")
		return segment.evaluateFrictionAt(x);
	else
		return segment.friction;
};


MotionSegment.prototype.getAllSegments = function() {
	return this.segments.getAllSegments();
};


/**
 * Calculates final time, acceleration, velocity and position for this segment
 * @return {MotionPoint} [tf,af,vf,pf]
 */
MotionSegment.prototype.getFinalValues = function() {
	var last = this.segments.lastSegment();
	var tf = last.finalTime;
	var af = last.evaluateAccelerationAt(tf);
	var vf = last.evaluateVelocityAt(tf);
	var pf = last.evaluatePositionAt(tf);
	var jf = last.evaluateJerkAt(tf);

	var point = new MotionPoint(tf, jf,af, vf, pf);

	return point;
};


/**
 * Calculates initial time, acceleration, velocity and position for this segment
 * @return {Array} [tf,af,vf,pf]
 */
MotionSegment.prototype.getInitialValues = function() {
	var first = this.segments.firstSegment();
	var t0 = first.initialTime;
	var a0 = first.evaluateAccelerationAt(t0);
	var v0 = first.evaluateVelocityAt(t0);
	var p0 = first.evaluatePositionAt(t0);
	var j0 = first.evaluateJerkAt(t0);

	return new MotionPoint(t0,j0, a0, v0, p0);
};


MotionSegment.prototype.setBasicSegmentLoads = function(loads) {
	if (!loads)
		return;
	var segments = this.getAllSegments();

	for (var i = segments.length - 1; i >= 0; i--) {
		segments[i].friction = loads.friction || 0;
		segments[i].thrust = loads.thrust || 0;
		segments[i].load = loads.load || 0;
	}
};

var factory = {};

factory.MotionSegment = MotionSegment;

module.exports = factory;