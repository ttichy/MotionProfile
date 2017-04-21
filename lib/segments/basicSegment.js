var polynomialFactory = require('../util/polynomial');
var MotionSegment = require('./motionSegment');
var FastMath = require('../util/fastMath');
var MotionPoint = require('../profile/motionPoint').MotionPoint;
var _ = require('underscore');

/**
 * constructor for basic motion segment
 * @param {int} t0                 initial time
 * @param {int} tf                 final time
 * @param {Array} positionPolyCoeffs array of polynomial coefficients [jerk, acc, vel, pos]
 * @param {Object} loads              load definition
 */
var BasicMotionSegment = function(t0, tf, positionPolyCoeffs, loads) {

	MotionSegment.MotionSegment.call(this, t0, tf);

	var poly = new polynomialFactory.createPolyAbCd(positionPolyCoeffs, t0, tf);

	this.segmentData={};
	var segD=this.segmentData;

	segD.positionCoeffs=positionPolyCoeffs;
	segD.initialTime=t0;
	segD.finalTime=tf;
	segD.loads=loads;


	this.type = "basic";

	this.positionPoly = poly;

	this.velocityPoly = this.positionPoly.derivative();
	this.accelPoly = this.velocityPoly.derivative();
	this.jerkPoly = this.accelPoly.derivative();

	//add the newly created object to the stash.
	// insertion needs to happen here, so the subsequent evaluate methods can complete
	this.segments.insertAt(this);


	//wait until polynomials are assigned, then calculate initial and final vel/pos
	this.initialVelocity = this.evaluateVelocityAt(t0);
	this.finalVelocity = this.evaluateVelocityAt(tf);

	this.initialPosition = this.evaluatePositionAt(t0);
	this.finalPosition = this.evaluatePositionAt(tf);

	if (!loads) {
		//thrust is external force or torque
		this.thrust = 0;

		//friction - either friction coefficient (for linear) or friction (for rotary)
		this.friction = 0;

		//load - either mass or inertia
		this.load = 0;
	} else {
		this.thrust = loads.thrust || 0;
		this.friction = loads.friction || 0;
		this.load = loads.load || 0;
	}


};

BasicMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
BasicMotionSegment.prototype.constructor = BasicMotionSegment;



BasicMotionSegment.prototype.chartPoints = function() {
	var duration = this.finalTime-this.initialTime;
	var step = duration / 10;
	var time=this.initialTime;
	var result = [];

	while (true){
		result.push([time,this.evaluatePositionAt(time), this.evaluateVelocityAt(time)]);

		time+=step;
		if(FastMath.geq(time,this.finalTime)){
			time = this.finalTime;
			result.push([time,this.evaluatePositionAt(time), this.evaluateVelocityAt(time)]);
			break;
		}
	}

	return result;
};


BasicMotionSegment.prototype.getExtremeValues = function () {
	var posEx = this.positionPoly.getExtremeValues();
	var velEx = this.velocityPoly.getExtremeValues();
	var accEx = this.accelPoly.getExtremeValues();
	var jerkEx = this.jerkPoly.getExtremeValues();

	var x = _.uniq([].concat(posEx.x, velEx.x, accEx.x, jerkEx.x)).sort(function (curr, next) {
		return curr-next;
	});

	var that = this;
	var mpArr = x.map(function (val) {
		// (t, j, a, v, p)
		return new MotionPoint(
			val,
			that.evaluateJerkAt(val),
			that.evaluateAccelerationAt(val),
			that.evaluateVelocityAt(val),
			that.evaluatePositionAt(val)
		);
	});

	return mpArr;
};


var factory = {};

factory.CreateBasicSegment = function(t0, tf, positionPolyCoeffs, loads) {
	if (tf <= t0)
		throw new Error('final time must be greater than initial time');
	if (!Array.isArray(positionPolyCoeffs) || positionPolyCoeffs.length != 4)
		throw new Error('expecting array of length 4');

	var segment = new BasicMotionSegment(t0, tf, positionPolyCoeffs, loads);
	return segment;
};

factory.BasicMotionSegment = BasicMotionSegment;

module.exports = factory;