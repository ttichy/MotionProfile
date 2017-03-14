/**
 * Segment represents basic segment functionality - has initial/final times and id
 *
 * Base type for MotionSegment and LoadSegment
 * 
 * @param {Number} t0 initial Time
 * @param {Number} tf final Time
 */
var Segment = function(t0, tf) {


	this.initialTime = t0;
	this.finalTime = tf;

	this.id = this.generateId();

};



/**
 * Generate unique id 
 */
Segment.prototype.generateId = function() {

	var mSec = (new Date()).getTime().toString();
	var rnd = Math.floor(Math.random() * 10000).toString();

	var idStr = mSec + rnd;

	return parseInt(idStr, 10);

};


var factory = {};

factory.Segment = Segment;

module.exports = factory;