var fastMath = require('../util/fastMath');
var polynomialFactory = require('../util/polynomial');
var Segment = require('./segment');
var Util = require('../util/util');

var LinearLoadsEnum = Object.freeze({
	"FRICTION_COEFF": 1,
	"MASS": 2,
	"FORCE": 3
});
var RotaryLoadsEnum = Object.freeze({
	"FRICTION": 1,
	"INERTIA": 2,
	"EXTERNAL_TORQUE": 3
});

/**
 * LoadSegment defines load with respect to time.
 * loads can only be lines, ie first degree polynomials
 * @param {Number} t0 initial Time
 * @param {Number} tf final Time
 * @param {Number} initVal initial load value
 * @param {Number} finalVal final load value
 */
var LoadSegment = function(type, t0, tf, initVal, finalVal) {


	Segment.Segment.call(this, t0, tf);


	this.segmentData= {
		initialTime: t0,
		finalTime: tf,
		initialValue: initVal,
		finalValue: finalVal,
		loadType: type
	};


	var slope = (finalVal - initVal) / (tf - t0);
	var iSect = initVal - slope * t0 + slope * t0;

	this.loadPoly = polynomialFactory.createPolyAbCd([0, 0, slope, iSect], t0, tf);
};


LoadSegment.prototype = Object.create(Segment.Segment.prototype);
LoadSegment.prototype.constructor = LoadSegment;


LoadSegment.prototype.evaluateLoadAt = function(x) {
	return this.loadPoly.evaluateAt(x);
};


/**
 * Reconstruct load segment from data representation
 * @param  {Object} data
 * @return {LoadSegment}      return newly constructed load segment
 */
LoadSegment.prototype.importFromData = function(data) {
	return new LoadSegment(data.loadType, data.initialType, data.finalTime, data.initialValue, data.finalValue);
};


/**
 * Exports data representation of the segment
 * @return {Object}      data representation of the load segment
 */
LoadSegment.prototype.exportData = function() {
	var data = {};
	Util.extend(data, this.segmentData);

	data.type = 'LoadSegment';

	return data;
};


/**
 * Check if load type is valid for a linear profile
 * @param  {string}  type load type
 * @return {Boolean}      true if load type valid
 */
LoadSegment.prototype.isValidType = function(profileType, type) {
	if (profileType === "linear")
		return LinearLoadsEnum[type];
	else
		return RotaryLoadsEnum[type];
};

var factory = {};

factory.createLoadSegment = function(type, t0, tf, initialLoad, finalLoad) {
	if (fastMath.lt(t0, 0) || fastMath.lt(tf, 0))
		throw new Error("initial time and final time must be greater than 0");
	if (fastMath.geq(t0, tf))
		throw new Error("final time must be greater than inital time");

	var valid = false;
	if (LinearLoadsEnum[type])
		valid = true;
	if (RotaryLoadsEnum[type])
		valid = true;

	if (valid === false)
		throw new Error("uknown load type " + type);
	var segment = new LoadSegment(type, t0, tf, initialLoad, finalLoad);
	return segment;
};

factory.LinearLoadsEnum = LinearLoadsEnum;
factory.RotaryLoadsEnum = RotaryLoadsEnum;
factory.LoadSegment = LoadSegment;

module.exports = factory;