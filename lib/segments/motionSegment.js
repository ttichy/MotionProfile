		var fastMath = require('../util/fastMath');
		var SegmentStash = require('segmentStash');
		var Segment = require('segment');

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



		MotionSegment.prototype.getAllSegments = function() {
			return this.segments.getAllSegments();
		};

		var factory = {};

		factory.MotionSegment = MotionSegment;

		module.exports = factory;