var polynomialFactory = require('../util/polynomial');
var MotionSegment = require('./motionSegment');
var FastMath = require('../util/fastMath');

/**
 * constructor for basic motion segment
 * @param {int} t0                 initial time
 * @param {int} tf                 final time
 * @param {Array} positionPolyCoeffs array of polynomial coefficients
 * @param {Object} loads              load definition
 */
var BasicMotionSegment = function(t0, tf, positionPolyCoeffs, loads) {

	MotionSegment.MotionSegment.call(this, t0, tf);

	var poly = new polynomialFactory.createPolyAbCd(positionPolyCoeffs, t0, tf);

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