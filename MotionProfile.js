(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = require('./profile/motionProfile.js');
},{"./profile/motionProfile.js":2}],2:[function(require,module,exports){
/**
 * Creates MotionProfile. MotionProfile is a list of MotionSegments.
 * MotionSegments represent the various available segments in a profile, such as BasicSegment, AccelSegment,
 * CamSegment, IndexSegment, etc...
 *
 */
var AccelSegment = require('../segments/accelSegment');
var IndexSegment = require('../segments/indexSegment');
var LoadSegment = require('../segments/loadSegment');
var CamSegment= require('../segments/camSegment');
var MotionSegment = require('../segments/motionSegment');
var SegmentStash = require('../segments/segmentStash');
var fastMath = require('../util/fastMath');
var profileHelper = require('./profileHelper');
var undoManager = require('../util/undoManager');
var Util = require('../util/util');

/**
 * MOTION PROFILE OBJECT LOGIC
 */

var MotionProfile = function(type) {
	// rotary is treated as default
	this.type = type.toLowerCase() === "rotary" ? "rotary" : "linear";
	this.initialPosition = 0;
	this.initialVelocity = 0;
	this.initialThrust = 0;
	this.initialLoad = 0;
	this.initialFriction = 0;

	//create object to hold all the profile loads
	var loads = {};

	if (this.type === "rotary") {
		Object.keys(LoadSegment.RotaryLoadsEnum).forEach(function(load) {
			loads[load] = SegmentStash.makeStash();
		});
	} else {
		Object.keys(LoadSegment.LinearLoadsEnum).forEach(function(load) {
			loads[load] = SegmentStash.makeStash();
		});
	}

	this.profileLoads = loads;
	this.undoManager = undoManager;

	MotionSegment.MotionSegment.call(this);
};


MotionProfile.prototype = Object.create(MotionSegment.MotionSegment.prototype);
MotionProfile.prototype.constructor = MotionProfile;


/**
 * Set the initial position and velocity for this motion profile
 * @param {Number} position position in [rad] or [m]
 * @param {Number} velocity velocity in [rad/s] or [m/s]
 */
MotionProfile.prototype.setInitialConditions = function(position, velocity, load, thrust, friction) {
	this.initialPosition = position;
	this.initialVelocity = velocity;

	this.initialThrust = thrust;
	this.initialLoad = load;
	this.initialFriction = friction;


	//after setting initial conditions, all subsequent modules must be recalculated
	var current = this.segments.firstSegment();

	this.recalculateProfileSegments(current);
};


/**
 * Gets all basic segments that exist in the profile. Basic Segments are the most basic building blocks
 */
MotionProfile.prototype.getAllBasicSegments = function() {
	var allSegments = [];
	// using associative array to hold all segments -> quick and easy to search
	this.segments.getAllSegments().forEach(function(element) {
		allSegments.push(element.getAllSegments());
	});

	// previous code gets us an array of arrays, we need to flatten it
	return allSegments.reduce(function(a, b) {
		return a.concat(b);
	});
};

/**
 * Recalculates motion profile segments due to a change. Starts recalculating at passed-in segment
 * @param  {MotionSegment} current segment to start recalculations
 */
MotionProfile.prototype.recalculateProfileSegments = function(current) {
	//nothing to do
	if (!current)
		return;

	if (!(current instanceof MotionSegment.MotionSegment))
		throw new Error('expecting a MotionSegment type');

	var prev, previousValues;
	while (current) {
		prev = this.segments.getPreviousSegment(current.id);

		//handle first segment
		if (!prev) {
			previousValues = [0, 0, this.initialVelocity, this.initialPosition];
		} else {
			previousValues = prev.getFinalValues();
		}

		current.modifyInitialValues(previousValues[0], previousValues[1], previousValues[2], previousValues[3]);

		//move next
		current = this.segments.getNextSegment(current.id);
	}
};


MotionProfile.prototype.getAllSegments = function() {
	return this.segments.getAllSegments();
};


/**
 * Checks and returns if exists an existing segment beginning at time initialTime
 * @param {number} initialTime initial time of segment to check
 * @returns {MotionSegment} existing segment or null if none found
 */
MotionProfile.prototype.getExistingSegment = function(initialTime) {
	return this.segments.findSegmentWithInitialTime(initialTime);
};


/**
 * Inserts or appends a segment into the motion profile
 * @param {MotionSegment} segment Segment to insert into the profile
 */
MotionProfile.prototype.insertSegment = function(segment, segmentId) {

	if (!(segment instanceof MotionSegment.MotionSegment))
		throw new Error('Attempting to insert an object which is not a MotionSegment');

	//need to get final values of previous segment
	var prev = this.segments.getPreviousSegment(segmentId);

	var lastValues;

	if (prev !== null) {
		//modify the segment being inserted to make sure initial values == previous segment's final values
		lastValues = prev.getFinalValues();
	} else {
		lastValues = [0, 0, this.initialVelocity, this.initialPosition];
	}

	segment.modifyInitialValues(lastValues[0], lastValues[1], lastValues[2], lastValues[3]);

	var newSegment = this.segments.insertAt(segment, segmentId);
	if (!newSegment)
		throw new Error("inserting a segment failed");

	//after inserting a segment, all subsequent segments must be recalculated
	var current = this.segments.getNextSegment(newSegment.id);
	this.recalculateProfileSegments(current);

	var profile = this;

	// undo /redo functionality
	this.undoManager.add({
		undo: function() {
			profile.deleteSegment(newSegment.id);
		},
		redo: function() {
			profile.insertSegment(segment, segmentId);
		}
	});

	return segment;
};


/**
 * Append segment at the end of the current profile
 * @param  {[type]} segment [description]
 * @return {[type]}         [description]
 */
MotionProfile.prototype.appendSegment = function(segment) {
	if (!(segment instanceof MotionSegment.MotionSegment))
		throw new Error('Attempting to insert an object which is not a MotionSegment');

	// even though we append at the end, still have to make sure that initial/final conditions are satisfied
	var lastSegment = this.segments.lastSegment();
	if (lastSegment) {
		var lastValues = lastSegment.getFinalValues();
		segment.modifyInitialValues(lastValues[0], lastValues[1], lastValues[2], lastValues[3]);
	}

	this.segments.insertAt(segment, null);

	var profile = this;

	// undo/redo functionality
	this.undoManager.add({
		undo: function() {
			profile.deleteSegment(segment.id);
		},
		redo: function() {
			profile.appendSegment(segment);
		}
	});

	return segment;
};


/**
 * Deletes specified segment. Suppose we have segments 1, 2 and 3 and want to delete 2.
 * 	First, we delete segment 2. Then, we modify the initial values of segment 3 to be the final values of segment 1
 * @param {MotionSegment} segmentId identify segment to delete
 */
MotionProfile.prototype.deleteSegment = function(segmentId) {

	if (!fastMath.isNumeric(segmentId) || fastMath.lt(segmentId, 0))
		throw new Error('expect segmentId to be a positive integer');

	var previous = this.segments.getPreviousSegment(segmentId);
	var current = this.segments.getNextSegment(segmentId);

	var segToDelete = this.segments.delete(segmentId);
	if (!segToDelete)
		throw new Error("Unable to delete segment with id " + segmentId);

	var currentId=null;
	if(current)
		currentId=current.id;

	//undo / redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.insertSegment(segToDelete, currentId);
		},
		redo: function() {
			profile.deleteSegment(segmentId);
		}
	});


	//could be the only segment
	if (this.segments.countSegments() === 0)
		return segToDelete;

	this.recalculateProfileSegments(current);



	return segToDelete;
};


/**
 * Removes all profile segments
 */
MotionProfile.prototype.clear = function() {

	//need to save all segments


	var that = this;
	this.getAllSegments().forEach(function(seg) {
		var segToDelete = that.segments.delete(seg.id);
	});
};


/**
 * Finds parent segment by child segment id. Eg. pass a basic segment id, get back its accel segment
 * @param  {int} segmentId segment id
 * @return {MotionSegment}           parent segment
 */
MotionProfile.prototype.findParentSegmentByChildId = function(segmentId) {
	if (!fastMath.isNumeric(segmentId) || fastMath.lt(segmentId, 0))
		throw new Error('expect segmentId to be a positive integer');

	var childSegment;
	var parentSegments = this.getAllSegments();

	// go through all parent segments and utilize its stash to try to find the child
	for (var i = parentSegments.length - 1; i >= 0; i--) {
		childSegment = parentSegments[i].segments.findById(segmentId);
		if (childSegment)
			return parentSegments[i];
	}

	return null;
};


/**
 *
 * @param {int} segmentId
 * @param {Object} newSegmentData new segment data
 * @param {Object} initialConditions initial conditions for the modified segment
 * @returns {MotionSegment}
 */
MotionProfile.prototype.modifySegmentValues = function(segmentId, newSegmentData, initialConditions) {
	var segment = this.findById(segmentId);
	if (!segment)
		throw new Error("Unable to find segment with id " + segmentId);

	var originalSegmentData = {};
	Util.extend(originalSegmentData, segment.segmentData);

	var modified = segment.modifySegmentValues(newSegmentData, initialConditions);

	//undo / redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.modifySegmentValues(segmentId, originalSegmentData, initialConditions);
		},
		redo: function() {
			profile.modifySegmentValues(segmentId, newSegmentData, initialConditions);
		}
	});

	return modified;
};


MotionProfile.prototype.undo = function() {
	if (!this.undoManager.hasUndo())
		throw new Error("There is nothing to undo");
	this.undoManager.undo();
};


MotionProfile.prototype.redo = function() {

	if (!this.undoManager.hasRedo())
		throw new Error("There is nothing to redo");

	this.undoManager.redo();
};


MotionProfile.prototype.findById = function(segmentId) {
	return this.segments.findById(segmentId);
};


MotionProfile.prototype.createLoadSegment = function(type, t0, tf, initialLoad, finalLoad) {
	if (!LoadSegment.LoadSegment.prototype.isValidType(this.type, type))
		throw new Error("Load type '" + type + "' is not valid for " + this.type + " profiles");

	return LoadSegment.createLoadSegment(type, t0, tf, initialLoad, finalLoad);
};


/**
 * Gets valid load types for profile type
 * @return {Array} valid load types
 */
MotionProfile.prototype.getValidLoadTypes = function() {
	if(this.type == 'linear') {
		return LoadSegment.LinearLoadsEnum;
	} else if (this.type == 'rotary') {
		return LoadSegment.RotaryLoadsEnum;
	}

	throw new Error('Unrecognized profile type: ' + this.type);
};


/**
 * Adds a load segment to the profile
 * @param {LoadSegment} loadSegment load segment to be added
 */
MotionProfile.prototype.addLoadSegment = function(loadSegment) {
	// insert or append
	if (this.profileLoads[loadSegment.segmentData.loadType].findOverlappingSegment(loadSegment.initialTime, loadSegment.finalTime))
		throw new Error("New segment overlaps an existing segment");

	// find previous segment. Needed in case of insertion
	var prevSegment = this.profileLoads[loadSegment.segmentData.loadType].getPreviousByInitialTime(loadSegment.t0);
	var prevId = null;
	if (prevSegment)
		prevId = prevSegment.id;

	if (this.profileLoads[loadSegment.segmentData.loadType].countSegments() === 0) {
		this.profileLoads[loadSegment.segmentData.loadType].insertAt(loadSegment, prevId);
	} else
		throw new Error("Currently, only one segment per type can be added");

	// undo/redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.deleteLoadSegment(loadSegment.id, loadSegment.segmentData.loadType);
		},
		redo: function() {
			profile.addLoadSegment(loadSegment);
		}
	});
};


/**
 * Deletes load segment identified by segmentId, optionally uses type to identify load type
 * @param  {Number} segmentId identfies segment
 * @param  {string} type      load type
 * @return {LoadSegment}      deleted load segment
 */
MotionProfile.prototype.deleteLoadSegment = function(segmentId, type) {
	// passing  type is optional, but helpful
	if (type) {
		if (!this.profileLoads[type])
			throw new Error("load type '" + type + "' doesn't appear to be a valid load segment type");
		return this.profileLoads[type].delete(segmentId);
	}

	var deletedSegment;

	var that = this;

	// type was not passed, have to check all types
	Object.keys(this.profileLoads).some(function(t) {
		deletedSegment = that.profileLoads[t].delete(segmentId);
		return deletedSegment !== null;
	});

	//undo / redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.addLoadSegment(deletedSegment);
		},
		redo: function() {
			profile.deleteLoadSegment(segmentId, type);
		}
	});

	return deletedSegment;
};


MotionProfile.prototype.modifyLoadSegment = function(segmentId, newSegmentData) {
	if (!newSegmentData.segmentData.loadType)
		throw new Error("Expecting new segment to have type");

	//forcing new segment to be the same type as old segment
	var segment = this.profileLoads[newSegmentData.segmentData.loadType].findById(segmentId);
	if (!segment)
		throw new Error("Unable to find segment with id " + segmentId + ".. is it of the same type as the old one?");

	this.profileLoads[newSegmentData.segmentData.loadType].delete(segmentId);

	this.addLoadSegment(newSegmentData);

	//undo / redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.deleteLoadSegment(newSegmentData.id);
			profile.addLoadSegment(segment, segment.type);
		},
		redo: function() {
			profile.modifyLoadSegment(segmentId, newSegmentData);
		}
	});
};


/**
 * Returns all load segments present in the motion profile of the specified type
 * @param  {string} type Load type
 * @return {Array}      array of load segments of specified type
 */
MotionProfile.prototype.getAllLoadSegments = function(type) {

	// if there is not specific type, all load segments are returned
	if(!type) {
		var allLoadSegments=[];
		var that=this;
		Object.keys(this.getValidLoadTypes()).forEach(function(type){
			allLoadSegments=allLoadSegments.concat(that.profileLoads[type].getAllSegments());
		});
		return allLoadSegments;
	}

	if (!this.profileLoads[type])
		throw new Error("load type '" + type + "' doesn't appear to be a valid load segment type");

	return this.profileLoads[type].getAllSegments();
};

var factory = {};

factory.createMotionProfile = function(type) {
	return new MotionProfile(type);
};


/**
 * Creates accel segment
 * @param  {string} type    absolute or incremental
 * @param  {Object} segment segment data from the user
 * @return {AccelSegment}         newly created acceleration segment
 */
factory.createAccelSegment = function(type, segment) {
	if (!type)
		throw new Error('Need type of segment to create');

	if (!segment)
		throw new Error("Need segment data to create a segment");

	var loads = {};

	loads.load = segment.load;
	loads.thrust = segment.thrust;
	loads.friction = segment.friction;

	switch (type) {
		case "time-distance":
			return AccelSegment.MakeFromTimeDistance(segment.t0, segment.tf, segment.p0, segment.v0, segment.pf, segment.jPct, segment.mode, loads);
		case "time-velocity":
			return AccelSegment.MakeFromTimeVelocity(segment.t0, segment.tf, segment.p0, segment.v0, segment.vf, segment.jPct, segment.mode, loads);

		default:
			throw new Error("segment type not supported");
	}
};


factory.createIndexSegment = function(segment) {

	if (!segment)
		throw new Error("Need segment data to create a segment");

	// function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode)
	return IndexSegment.Make(segment.t0, segment.tf, segment.p0, segment.pf, segment.v, segment.velLimPos, segment.velLimNeg, segment.accJerk, segment.decJerk, segment.xSkew, segment.ySkew, segment.shape, segment.mode);
};

factory.createCamSegment = function(prevTime,prevPosition,prevVelocity,loads) {
	return CamSegment.createCamSegment(prevTime,prevPosition,prevVelocity,loads);
};


factory.createLoadSegment = function(loadType, t0, tf, initVal, finalVal ){
	return LoadSegment.createLoadSegment(loadType, t0, tf, initVal, finalVal);
};


/**
 * Exports profile data to JSON to be saved
 * @param {Object} profile MotionProfile to be serialized
 * @return {string} JSON representation of the entire profile
 */
factory.serialize = function(profile) {
	var profileObj = {};

	profileObj.type = profile.type;
	profileObj.initialPosition = profile.initialPosition;
	profileObj.initialVelocity = profile.initialVelocity;
	profileObj.initialLoad = profile.initialLoad;
	profileObj.initialThrust = profile.initialThrust;
	profileObj.initialFriction = profile.initialFriction;

	var segments = [];
	var loadSegments = [];

	profile.getAllSegments().forEach(function(segment) {
		var segData = segment.exportData();
		segments.push(segData);
	});

	profile.getAllLoadSegments().forEach(function(loadSeg) {
		loadSegments.push(loadSeg.exportData());
	});

	profileObj.segments = segments;
	profileObj.loadSegments = loadSegments;

	return JSON.stringify(profileObj);
};


/**
 * Deseralize
 * @param  {[type]} json [description]
 * @return {[type]}      [description]
 */
factory.deserialize = function(jsonProfile) {
	var profileGraph;
	try {
		profileGraph = JSON.parse(jsonProfile);
	} catch (e) {
		throw new Error("Unable to parse JSON string");
	}

	var profileObj = profileGraph;
	if (!profileObj)
		throw new Error("Expecting key 'profile' to exist in the json string");

	var that = this;

	var profile = new MotionProfile(profileObj.type);
	profileGraph.segments.forEach(function(segObj) {
		var segment = that[segObj.type].prototype.importFromData(segObj);
		profile.appendSegment(segment);
	});

	profileGraph.loadSegments.forEach(function(loadObj){
		var loadSeg=LoadSegment.createLoadSegment(loadObj.loadType,
		loadObj.initialTime, loadObj.finalTime,
		loadObj.initialValue, loadObj.finalValue);
		profile.addLoadSegment(loadSeg);
	});


	return profile;
};


factory.AccelMotionSegment = AccelSegment.AccelMotionSegment;
factory.IndexMotionSegment = IndexSegment.IndexMotionSegment;
factory.CamMotionSegment = CamSegment.CamMotionSegment;

module.exports = factory;
},{"../segments/accelSegment":4,"../segments/camSegment":6,"../segments/indexSegment":7,"../segments/loadSegment":8,"../segments/motionSegment":9,"../segments/segmentStash":11,"../util/fastMath":12,"../util/undoManager":15,"../util/util":16,"./profileHelper":3}],3:[function(require,module,exports){
var fastMath = require('../util/fastMath');
var basicSegmentFactory = require('../segments/basicSegment');


exports.sortBasicSegments = function(basicSegments) {
	this.validateSegments(basicSegments);

	// since segments are validated, we can just sort on initial time
	var sorted = basicSegments.sort(function(segmentA, segmentB) {
		return fastMath.compareNumbers(segmentA.t0, segmentB.t0);
	});

	return sorted;

};

exports.validateBasicSegments = function(basicSegments) {
	if (!Array.isArray(basicSegments))
		throw new Error('sortBasicSegments expects an array');

	for (var i = 0; i <= basicSegments.length - 1; i++) {
		var segment = basicSegments[i];

		if (!(segment instanceof basicSegmentFactory.BasicMotionSegment))
			throw new Error('segment `' + i + '` is not MotionSegment type');

		if (fastMath.equal(segment.initialTime, segment.finalTime))
			throw new Error('Segment starting at ' + segment.initialTime + ' has the same final time');

		if (fastMath.gt(segment.initialTime, segment.finalTime))
			throw new Error('Segment starting at ' + segment.initialTime + 'has initial time greater than final time');

		//skip this for the first segment
		if (i > 0) {
			if (fastMath.notEqual(segment.initialTime, basicSegments[i - 1].finalTime))
				throw new Error('Segment starting at ' + segment.initialTime + ' does not have t0 same as previous segment tf');

			if (fastMath.notEqual(segment.initialVelocity, basicSegments[i - 1].finalVelocity))
				throw new Error('Segment starting at ' + segment.initialTime + ': previous segment final velocity does not match');

			if (fastMath.notEqual(segment.initialPosition, basicSegments[i - 1].finalPosition))
				throw new Error('Segment starting at ' + segment.initialTime + ': previous segment final position does not match');


		}

	}
	return true;
}
},{"../segments/basicSegment":5,"../util/fastMath":12}],4:[function(require,module,exports){
var MotionSegment = require('./motionSegment');
var basicSegmentFactory = require('./basicSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var factory = {};

/**
 * AccelMotion segment constructor
 * @param {Array} basicSegments [array of basic segments]
 */
var AccelMotionSegment = function(basicSegments) {
	if (!Array.isArray(basicSegments))
		throw new Error('Expecting an array parameter');
	if (basicSegments.length < 1 || basicSegments.length > 3)
		throw new Error('Expecting aray length to be 1,2 or 3');

	var t0 = basicSegments[0].initialTime;
	var tf = basicSegments[basicSegments.length - 1].finalTime;

	MotionSegment.MotionSegment.call(this, t0, tf);

	//TODO: check ordering of the basicSegments (increasing time)

	this.type = 'acceleration';


	// each segment (regardless of type) has initialTime and finalTime
	this.initialTime = basicSegments[0].initialTime;
	this.finalTime = basicSegments[basicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(basicSegments);
};


AccelMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
AccelMotionSegment.prototype.constructor = AccelMotionSegment;


/**
 * Gets pertinenta data to be able to serialize/deserilize segment
 * @return {object} data representation of the segment
 */
AccelMotionSegment.prototype.exportData = function() {

	var dataObj=MotionSegment.MotionSegment.prototype.exportData.call(this);

	dataObj.type = 'AccelMotionSegment';

	return dataObj;

};

/**
 * Deserialize(create) AccelMotionSegment from a json string
 * @param  {Object} data data representation of the segment (see exportData())
 * @return {AccelMotionSegment}      [description]
 */
AccelMotionSegment.prototype.importFromData = function(data) {

	switch (data.constructor) {
		case "AccelSegmentTimeVelocity":
			return new AccelSegmentTimeVelocity(0, data.duration, 0, 0, data.finalVelocity, data.jerkPercent, data.mode, data.loads);

		case "AccelSegmentTimeDistance":
			return new AccelSegmentTimeDistance(0, data.duration, 0, 0, data.distance, data.jerkPercent, data.mode, data.loads);
	}

	throw new Error("Unkown AccelSegment type: " + data.constructor);

};



var AccelSegmentTimeVelocity = function(t0, tf, p0, v0, vf, jPct, mode, loads) {

	if (arguments.length <= 7)
		throw new Error("Expected at least 7 arguments in AccelSegmentTimeVelocity constructor");

	if (mode !== "absolute")
		mode = "incremental";

	var loads_copy = {};
	Util.extend(loads_copy, loads);

	this.segmentData = {
		dataPermutation: "time-velocity",
		mode: mode,
		initialTime: t0,
		finalTime: tf,
		initialVelocity: v0,
		finalVelocity: vf,
		duration: tf - t0,
		jerkPercent: jPct,
		loads: loads_copy
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, v0, vf, jPct);

	AccelMotionSegment.call(this, basicSegments);
	this.setBasicSegmentLoads(loads);

};



AccelSegmentTimeVelocity.prototype = Object.create(AccelMotionSegment.prototype);
AccelSegmentTimeVelocity.prototype.constructor = AccelSegmentTimeVelocity;


/**
 * Calculates and creates the 1 to 3 basic segments that AccelSegment consists of
 * @param  {Number} t0   initial time
 * @param  {Number} tf   finalt time
 * @param  {Number} p0   initial position
 * @param  {Number} v0   initial velocity
 * @param  {Number} vf   final velocity
 * @param  {Number} jPct jerk percentage
 * @return {Array}      Array of BasicSegment
 */
AccelSegmentTimeVelocity.prototype.calculateBasicSegments = function(t0, tf, p0, v0, vf, jPct) {
	var basicSegment, basicSegment2, basicSegment3;
	var accelSegment;
	var coeffs, coeffs1, coeffs2, coeffs3, coeffs4;

	if (jPct === 0) {
		// consists of one basic segment
		coeffs = [0, 0.5 * (vf - v0) / (tf - t0), v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, tf, coeffs);

		return [basicSegment];
	}

	var aMax;
	var jerk;
	var th;

	if (jPct == 1) {
		// two basic segments

		// th - duration of half the accel segment
		th = (tf - t0) / 2;
		aMax = (vf - v0) / th;
		jerk = aMax / th;

		coeffs1 = [jerk / 6, 0, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + th, coeffs1);

		// coeffs2 = [basicSegment.evaluatePositionAt(t0 + th), basicSegment.evaluateVelocityAt(t0 + th), aMax / 2, -jerk / 6];
		coeffs2 = [-jerk / 6,  aMax / 2, basicSegment.evaluateVelocityAt(t0 + th), basicSegment.evaluatePositionAt(t0 + th)];

		basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + th, tf, coeffs2);

		return [basicSegment, basicSegment2];
	}

	// last case is three basic segments

	var td1; //duration of first and third segments
	var tdm; //duration of the middle segment
	td1 = 0.5 * jPct * (tf - t0);
	tdm = tf - t0 - 2 * (td1);

	//calculate max accel by dividing the segment into three chunks
	// and using the fact that (vf-v0) equals area under acceleration
	aMax = (vf - v0) / (td1 + tdm);
	jerk = aMax / td1;

	coeffs1 = [jerk / 6, 0, v0, p0];
	basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + td1, coeffs1);

	coeffs2 = [0, aMax / 2, basicSegment.evaluateVelocityAt(t0 + td1), basicSegment.evaluatePositionAt(t0 + td1)]; // middle segment has no jerk

	basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + td1, t0 + td1 + tdm, coeffs2);

	coeffs3 = [-jerk / 6, aMax / 2, basicSegment2.evaluateVelocityAt(t0 + td1 + tdm), basicSegment2.evaluatePositionAt(t0 + td1 + tdm)];
	basicSegment3 = basicSegmentFactory.CreateBasicSegment(t0 + td1 + tdm, tf, coeffs3);


	return [basicSegment, basicSegment2, basicSegment3];
};


/**
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * Modification takes into account absolute vs incremental mode
 * @param {float} t0 new initial time
 * @param {float} a0 new initial acceleration
 * @param {float} v0 new initial velocity
 * @param {float} p0 new initial position
 */
AccelSegmentTimeVelocity.prototype.modifyInitialValues = function(t0, a0, v0, p0) {

	var tf, vf;

	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		vf = v0 + this.segmentData.finalVelocity - this.segmentData.initialVelocity;
	} else {
		tf = this.segmentData.finalTime;
		this.segmentData.duration = tf - t0;
		vf = this.segmentData.finalVelocity;
		if (fastMath.lt(this.segmentData.duration, 0))
			throw new Error('tried to move initial time past final time for absolute segment');
	}

	var newBasicSegments = this.calculateBasicSegments(t0, tf, p0, v0, vf, this.segmentData.jerkPercent);

	this.initialTime = newBasicSegments[0].initialTime;
	this.finalTime = newBasicSegments[newBasicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};

/**
 * Edit user entered segment values
 * @param  {Object} newSegmentData      new user entered data
 * @param {Object} initialConditions initial conditions
 */
AccelSegmentTimeVelocity.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {

	if (newSegmentData.mode !== "absolute")
		newSegmentData.mode = "incremental";

	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.initialVelocity = newSegmentData.initialVelocity || this.segmentData.initialVelocity;
	this.segmentData.finalVelocity = newSegmentData.finalVelocity || this.segmentData.finalVelocity;
	this.segmentData.duration = newSegmentData.duration || this.segmentData.duration;
	this.segmentData.jerkPercent = newSegmentData.jerkPercent || this.segmentData.jerkPercent;
	this.segmentData.loads = {};
	Util.extend(this.segmentData.loads, newSegmentData.loads);

	this.finalTime = this.initialTime + this.segmentData.duration;

	var newBasicSegments = this.calculateBasicSegments(this.initialTime,
		this.finalTime,
		initialConditions.position,
		initialConditions.velocity,
		this.segmentData.finalVelocity,
		this.segmentData.jerkPercent
	);

	this.segments.initializeWithSegments(newBasicSegments);

	this.setBasicSegmentLoads(newSegmentData.loads);
	return this;
};


/**
 * Acceleration segment that is based on time and distance.
 * When initial conditions change, it is recalculated such that the duration and final position stay the same
 * @param {Number} t0   initial time
 * @param {Number} tf   final time
 * @param {Number} p0   initial position
 * @param {Number} v0   initial velocity
 * @param {Number} pf   final position
 * @param {Number} jPct percent jerk
 * @param {string} mode absolute or incremental
 */
var AccelSegmentTimeDistance = function(t0, tf, p0, v0, pf, jPct, mode, loads) {
	if (arguments.length <= 7)
		throw new Error("Expected at least 7 arguments in AccelSegmentTimeDistance constructor");

	if (mode !== "absolute")
		mode = "incremental";


	var loads_copy = {};
	Util.extend(loads_copy, loads);

	//incremental and absolute segments are instantiated the same way
	this.segmentData = {
		dataPermutation: "time-distance",
		finalPosition: pf,
		finalTime: tf,
		distance: pf - p0,
		duration: tf - t0,
		mode: mode,
		jerkPercent: jPct,
		loads: loads_copy
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, v0, pf, jPct);

	AccelMotionSegment.call(this, basicSegments);
	this.setBasicSegmentLoads(loads);
};

AccelSegmentTimeDistance.prototype = Object.create(AccelMotionSegment.prototype);
AccelSegmentTimeDistance.prototype.constructor = AccelSegmentTimeDistance;

/**
 * Calculates and creates the 1 to 3 basic segments that AccelSegment consists of
 * @param  {Number} t0   initial time
 * @param  {Number} tf   finalt time
 * @param  {Number} p0   initial position
 * @param  {Number} v0   initial velocity
 * @param  {Number} vf   final velocity
 * @param  {Number} jPct jerk percentage
 * @return {Array}      Array of BasicSegment
 */
AccelSegmentTimeDistance.prototype.calculateBasicSegments = function(t0, tf, p0, v0, pf, jPct) {
	var basicSegment, basicSegment2, basicSegment3;
	var accelSegment, aMax;
	var coeffs, coeffs1, coeffs2, coeffs3, coeffs4;
	var jerk;
	var th;
	if (jPct === 0) {
		// consists of one basic segment
		aMax = (2 * (pf - p0)) / fastMath.sqr(tf - t0);
		coeffs = [0, 0.5 * aMax, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, tf, coeffs);

		return [basicSegment];
	}

	//function to calculate max acceleration for this segment
	var maxAccel = function(v0) {

		var duration = this.segmentData.duration;

		var t1 = 0.5 * this.segmentData.jerkPercent * (duration);
		var tm = duration - 2 * (t1);
		var t2 = t1; //no skew for now

		var sqr = fastMath.sqr;


		var numerator = this.segmentData.distance - v0 * (duration);

		var denominator = sqr(t1) / 6 + 0.5 * t1 * tm + 0.5 * sqr(tm) + 0.5 * t1 * t2 + tm * t2 + sqr(t2) / 3;

		var aMax = numerator / denominator;

		return aMax;

	};


	aMax = maxAccel.call(this, v0);

	if (jPct == 1) {
		// two basic segments

		jerk = aMax / th;

		coeffs1 = [jerk / 6, 0, v0, p0];

		basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + th, coeffs1);

		coeffs2 = [basicSegment.evaluatePositionAt(t0 + th), basicSegment.evaluateVelocityAt(t0 + th), aMax / 2, -jerk / 6];

		basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + th, tf, coeffs2);

		return [basicSegment, basicSegment2];
	}

	// last case is three basic segments

	var td1; //duration of first and third segments
	var tdm; //duration of the middle segment
	td1 = 0.5 * jPct * (tf - t0);
	tdm = tf - t0 - 2 * (td1);

	jerk = aMax / td1;

	coeffs1 = [jerk / 6, 0, v0, p0];
	basicSegment = basicSegmentFactory.CreateBasicSegment(t0, t0 + td1, coeffs1);

	coeffs2 = [0, aMax / 2, basicSegment.evaluateVelocityAt(t0 + td1), basicSegment.evaluatePositionAt(t0 + td1)]; // middle segment has no jerk
	basicSegment2 = basicSegmentFactory.CreateBasicSegment(t0 + td1, t0 + td1 + tdm, coeffs2);

	coeffs3 = [-jerk / 6, aMax / 2, basicSegment2.evaluateVelocityAt(t0 + td1 + tdm), basicSegment2.evaluatePositionAt(t0 + td1 + tdm)];
	basicSegment3 = basicSegmentFactory.CreateBasicSegment(t0 + td1 + tdm, tf, coeffs3);


	return [basicSegment, basicSegment2, basicSegment3];
};


/**
 * Modifies segment initial values. Used when adding a point in the middle of a segment.
 * @param {float} t0 new initial time
 * @param {float} a0 new initial acceleration
 * @param {float} v0 new initial velocity
 * @param {float} p0 new initial position
 */
AccelSegmentTimeDistance.prototype.modifyInitialValues = function(t0, a0, v0, p0) {

	var tf, pf;

	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.distance;
	} else {
		//absolute mode
		tf = this.segmentData.finalTime;
		this.segmentData.duration = tf - t0;
		pf = this.segmentData.finalPosition;
		this.segmentData.distance = pf - p0;
		if (fastMath.lt(this.segmentData.duration, 0))
			throw new Error("attempt to change initial time past final time for absolute segment");
	}

	var newBasicSegments = this.calculateBasicSegments(t0, tf, p0, v0, pf, this.segmentData.jerkPercent);

	this.initialTime = newBasicSegments[0].initialTime;
	this.finalTime = newBasicSegments[newBasicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};


/**
 * Edit user entered segment values
 * @param  {Object} newSegmentData      new user entered data
 * @param {Object} initialConditions initial conditions
 */
AccelSegmentTimeDistance.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {


	if (newSegmentData.mode !== "absolute")
		newSegmentData.mode = "incremental";


	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.distance = newSegmentData.distance || this.segmentData.distance;
	this.segmentData.duration = newSegmentData.duration || this.segmentData.duration;
	this.segmentData.jerkPercent = newSegmentData.jerkPercent || this.segmentData.jerkPercent;

	this.finalTime = this.initialTime + this.segmentData.duration;

	this.segmentData.loads = {};
	Util.extend(this.segmentData.loads, newSegmentData.loads);

	var newBasicSegments = this.calculateBasicSegments(this.initialTime,
		this.finalTime,
		initialConditions.position,
		initialConditions.velocity,
		initialConditions.position + this.segmentData.distance,
		this.segmentData.jerkPercent
	);

	this.segments.initializeWithSegments(newBasicSegments);
	this.setBasicSegmentLoads(newSegmentData.loads);

	return this;


};



/**
 * Makes a new AccelMotionSegment given velocity information
 * @param {number} t0 [initial time]
 * @param {number} tf [final time]
 * @param {number} p0 [initial position]
 * @param {number} v0 [final position]
 * @param {number} vf [final velocity]
 * @param {number} jPct  [jerk as a percent of time]
 * @param {string} mode incremental or absolute
 * @returns {AccelMotionSegment} [freshly created accel segment]
 */
factory.MakeFromTimeVelocity = function(t0, tf, p0, v0, vf, jPct, mode, loads) {

	if (Util.isUndefined(jPct) || jPct < 0 || jPct > 1)
		throw new Error('expecting jerk between <0,1>');

	var accelSegment = new AccelSegmentTimeVelocity(t0, tf, p0, v0, vf, jPct, mode, loads);

	return accelSegment;

};

/**
 * Makes a new AccelMotionSegment given velocity information
 * @param {Number} t0 [initial time]
 * @param {Number} tf [final time]
 * @param {Number} p0 [initial position]
 * @param {Number} v0 [final position]
 * @param {Number} pf final velocity
 * @param {Number} jPct  [jerk as a percent of time]
 * @returns {AccelMotionSegment} [freshly created accel segment]
 */
factory.MakeFromTimeDistance = function(t0, tf, p0, v0, pf, jPct, mode, loads) {

	if (Util.isUndefined(jPct) || jPct < 0 || jPct > 1)
		throw new Error('expecting jerk between <0,1>');
	//TODO: more parameter checks

	var accelSegment = new AccelSegmentTimeDistance(t0, tf, p0, v0, pf, jPct, mode, loads);

	return accelSegment;


};

factory.calculateTimeVelocityBasicSegments = AccelSegmentTimeVelocity.prototype.calculateBasicSegments;


factory.AccelMotionSegment = AccelMotionSegment;

module.exports = factory;
},{"../util/fastMath":12,"../util/util":16,"./basicSegment":5,"./motionSegment":9}],5:[function(require,module,exports){
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
},{"../util/fastMath":12,"../util/polynomial":14,"./motionSegment":9}],6:[function(require,module,exports){
var MotionSegment = require('./motionSegment');
var BasicSegment = require('./basicSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var numeric = require('numeric');

var factory = {};

var InterpolationEnum = Object.freeze({
    "LINEAR": 0,
    "CUBIC":1
});


/** Describes cam data table
The expectation is that the first item in master and slave array is the initial time and initial position resp.
 */
var CamTable = function() {
    this.master=[];
    this.slave=[];
    this.interpolation=[];
    this.finalSlope=0;
    this.initialSlope=0;
};


/**
 * Validates data in the cam table
 * @return {[type]} [description]
 */
CamTable.prototype.validate = function() {
    
    if (!Array.isArray(this.master))
        throw new Error("expecting `master` data to be array");

    if (!Array.isArray(this.master))
        throw new Error("Expecting `slave` data to be array");

    if (this.master.length != this.slave.length)
        throw new Error("Expecting `master` and `slave` to have the same length");


    if (!Array.isArray(this.interpolation))
        throw new Error("Expecting `interpolation` to be an array");

    if (this.interpolation.length != this.master.length - 1)
        throw new Error("Expecting `interpolation` length to be one less than `master` length");


    if (!this.interpolation.every(function(el, idx, array) {

            return el === InterpolationEnum.CUBIC || el === InterpolationEnum.LINEAR;
        }))
        throw new Error("only 1 or 0 is a valid interploation type");


    for (var i = 1; i < this.master.length; i++) {
        if(!Number.isFinite(this.master[i]))
            throw new Error("Expecting master value at row "+i+" to be finite");
        if(!Number.isFinite(this.master[i-1]))
            throw new Error("Expecting master value at row "+i+" to be finite");
        if(fastMath.leq(this.master[i],this.master[i-1]))
            throw new Error("Expecting master values to be sorted ascending");
    }

    return true;

};



/**
 * CamMotionSegment -  handles operations on cam segments
 * @param {number} prevTime previous segment's final time
 * @param {number} prevPosition previous segment's final position
 * @param {number} prevVelocity previous segments' final velocity
 */
var CamMotionSegment = function(prevTime, prevPosition, prevVelocity,loads) {

    var t0 = prevTime || 0;
    var p0 = prevPosition || 0;
    var v0 = prevVelocity || 0;

    var tf = t0 + 1; // default - add 1 second just like MA7

    var pf = p0+1 ; // MA7 like

    MotionSegment.MotionSegment.call(this, t0, tf);

    this.segmentData=new CamTable();

    
    this.segmentData.master= [t0,tf];
    this.segmentData.slave=[p0,pf];
    this.segmentData.interpolation= [InterpolationEnum.CUBIC];
    this.segmentData.initialSlope= prevVelocity;
    this.segmentData.finalSlope = 0;


    this.type = 'cam';

    if(! loads) {
         //thrust is external force or torque
            this.thrust = 0;

            //friction - either friction coefficient (for linear) or friction (for rotary)
            this.friction = 0;

            //load - either mass or inertia
            this.load = 0;
    }
    else {
        this.thrust = loads.thrust || 0;
        this.friction = loads.friction || 0;
        this.load = loads.load || 0;
    }

    var basicSegments = this.calculateBasicSegments(this.segmentData);

    this.segments.initializeWithSegments(basicSegments);

};


CamMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
CamMotionSegment.prototype.constructor = CamMotionSegment;


/**
 * Calculates linear interpolation for X and Y points
 * @param {array} X array of master positions
 * @param {array} Y array of slave positions
 */
CamMotionSegment.prototype.calculateLinear = function(X, Y) {

    if (!Array.isArray(X) || !Array.isArray(Y))
        throw new Error("X and Y must be arrays");

    if (X.length != Y.length) {
        throw new Error("Matrices must have the same length");
    }

    if (X.length == 1)
        throw new Error("Cannot interpolate a single point");

    var A = [];

    for (var i = 1; i < X.length; i++) {
        var slope = (Y[i] - Y[i - 1]) / (X[i] - X[i - 1]);
        var icpt = Y[i - 1];
        A[i - 1] = [icpt, slope, 0, 0];
    }


    return A;

};


/**
 * Calculates coefficients for an array of X and Y values using cubic splines
 * @param {double Array} X  array of X values
 * @param {double Array} Y  array of Y values
 * @param {double} s0 initial slope
 * @param {double} sf final slope
 */
CamMotionSegment.prototype.calculateCubic = function(X, Y, s0, sf) {

    //-----<INPUTS>---------------------------------------

    // var s0=0;
    // var sf=0;

    // var X = [1,2];   //define X points
    // var Y = [2,4];   //define Y points
    //-----</INPUTS>----------------------------------------


    // data checks
    if (!Array.isArray(X) || !Array.isArray(Y))
        throw new Error("X and Y must be arrays");

    if (X.length != Y.length) {
        throw new Error("Matrices must have the same length");
    }

    if (X.length == 1)
        throw new Error("Cannot interpolate a single point");

    /**
     * [Am populate matrix row]
     * @param {int} m [1, 2 or 3 which row entry (each matrix row has three entries]
     * @param {int} r matrix row
     * @param {array} h array of hs (master position differences)
     */
    var Am = function(m, r, h) {

        var hSize = h.length + 1;
        if (r > hSize)
            throw new Error("passed row number too large.");

        // juggle the h's a bit in order to make handle first and last row
        var prevH = h[r - 1];
        if (!!!prevH)
            prevH = 0;
        var thisH = h[r];
        if (!!!thisH)
            thisH = 0;


        switch (m) {
            case 1:
                return prevH;
            case 2:
                return 2 * (prevH + thisH);
            case 3:
                return thisH;
            default:
                throw new Error("only 1,2 or 3 are valid values for m");

        }
    };

    var Bm = function(r, d) {
        //first row?
        if (r === 0)
            return 6 * (d[0] - s0);

        //last row?
        if (r == d.length)
            return 6 * (sf - d[r - 1]);

        //all other rows
        return 6 * (d[r] - d[r - 1]);
    };

    // define and assign h and slopes d
    var h = [];
    var d = [];

    for (var i = 1; i < X.length; i++) {
        h[i - 1] = X[i] - X[i - 1];
        d[i - 1] = (Y[i] - Y[i - 1]) / h[i - 1];
    }

    // need to have matrices in form AX=B, then can do
    // inv(A)*B=X

    var rows = X.length;
    var cols = rows;

    var A = [];
    var B = [];
    var C = [];


    for (var row = 0; row < rows; row++) {
        //create a new row and fill with zeroes
        A[row] = Array.apply(null, new Array(cols)).map(Number.prototype.valueOf, 0);

        // which column to start in
        var startCol = row - 1;
        var stopCol = startCol + 2;

        //special cases for first and last row
        if (startCol < 0) {
            stopCol = 1;
            startCol = 0;
        }

        if (stopCol > rows - 1)
            stopCol = rows - 1;

        for (var col = startCol; col <= stopCol; col++) {
            A[row][col] = Am(col - row + 2, row, h);
        }

        B[row] = [];
        B[row][0] = Bm(row, d);

    }

    var Ainv = numeric.inv(A);
    C = numeric.dot(Ainv, B);

    //flatten result into one array mk
    var mk = [];
    mk = mk.concat.apply(mk, C);

    //calculate the rest of coefficients
    var aa = [];
    var bb = [];
    var cc = [];
    var dd = [];
    var result = [];

    for (i = 0; i < X.length - 1; i++) {
        aa[i] = Y[i];
        bb[i] = d[i] - (h[i] / 6) * (2 * mk[i] + mk[i + 1]);
        cc[i] = mk[i] / 2;
        dd[i] = (mk[i + 1] - mk[i]) / (6 * h[i]);

        result[i] = [];
        result[i] = [aa[i], bb[i], cc[i], dd[i]];
    }

    return (result);
};


/**
 * Gets pertinenta data to be able to serialize/deserilize segment
 * @return {object} data representation of the segment
 */
CamMotionSegment.prototype.exportData = function() {
    var dataObj = {};

    Util.extend(dataObj, this.segmentData);
    dataObj.constructor = this.constructor.name;
    dataObj.type = 'CamMotionSegment';

    return dataObj;

};


/**
 * Deserialize(create) CamMotionSegment from a json string
 * @param  {Object} data data representation of the segment (see exportData())
 * @return {CamMotionSegment}      [description]
 */
CamMotionSegment.prototype.importFromData = function(data) {

    throw new Error("not implemented yet");

};


/**
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * @param {number} initialTime new initial time
 * @param {number} initialPosition new initial position
 * @param {number} initialVelocity new initial velocity (initial slope);
 */
CamMotionSegment.prototype.modifyInitialValues = function(initialTime, initialAcceleration, initialVelocity,initialPosition) {
    if(initialTime < 0)
        throw new Error("initialTime < zero. Cam table master values can't be negative");

    var timeDelta = initialTime-this.segmentData.master[0];
    var posDelta =initialPosition-this.segmentData.slave[0];

    for (var i = 0; i < this.segmentData.master.length; i++) {
        this.segmentData.master[i]+=timeDelta;
        this.segmentData.slave[i] +=posDelta;
    }

    this.segmentData.initialSlope=initialVelocity;

    var basicSegments = this.calculateBasicSegments(this.segmentData);

    this.initialTime=this.segmentData.master[0];
    this.finalTime=this.segmentData.master[this.segmentData.master.length-1];

    this.segments.initializeWithSegments(basicSegments);

};

/**
 * Modifies cam valus with new camtable.
 * Expects cam table has been offset by initial values in UI
 * @param  {Object} camData new cam data
 */
CamMotionSegment.prototype.modifySegmentValues = function(newSegmentData) {
    
    var loads=newSegmentData.loads;
    var camTable = newSegmentData.camTable;

    var finSlope = camTable.finalSlope || 0;
    if(loads)
    {
        this.segmentData.thrust=loads.thrust;
        this.segmentData.load=loads.load;
        this.segmentData.friction=loads.friction;
    }

    this.segmentData.master=camTable.master;
    this.segmentData.slave=camTable.slave;
    this.segmentData.interpolation=camTable.interpolation;
    this.segmentData.finalSlope=finSlope;

    var basicSegments = this.calculateBasicSegments(this.segmentData);

    this.segments.initializeWithSegments(basicSegments);
};

/**
 * Calculates basic segments from a CamTable
 * @param  {CamTable} camTable cam table entered by the user
 * @return {Array}          array of new basic segments
 */
CamMotionSegment.prototype.calculateBasicSegments = function(camTable) {

    if(!(camTable instanceof CamTable))
        throw new Error("Expecting a valid CamTable object in CamMotionSegment.calculateBasicSegments");

    var master=camTable.master;
    var slave = camTable.slave;
    var interpolation =camTable.interpolation;
    var initialSlope=camTable.initialSlope;
    var finalSlope = camTable.finalSlope;


    var result = [];    //used to return coefficients

    var currentRow = 1;
    var cubicStart = 0;
    var initSlope = initialSlope;
    var finSlope;
    var cubicSegs,cubicMasters;
    var coeffs3;
    var seg,i;
    var basicSegments=[];

    while (currentRow <= master.length - 1) {

        //skip cubic segments until there is a linear one
        if (interpolation[currentRow - 1] === 0) {

            //calculate the linear segment first, cuz need final slope
            var linRes = this.calculateLinear(master.slice(currentRow - 1, currentRow + 1), slave.slice(currentRow - 1, currentRow + 1));

            finSlope = linRes[0][1];

            //need to calculate all previous cubic rows
            cubicSegs = currentRow - cubicStart;

            cubicMasters=master.slice(cubicStart, cubicStart + cubicSegs);
            
            if (cubicSegs > 1) {
                coeffs3 = this.calculateCubic(cubicMasters,
                    slave.slice(cubicStart, cubicStart + cubicSegs),
                    initSlope,
                    finSlope);


                //result = result.concat(coeffs3);

                //coeffs3 is an array of arryays
                for (i = 0; i < coeffs3.length; i++) {
                    seg = BasicSegment.CreateBasicSegment(cubicMasters[i],cubicMasters[i+1],coeffs3[i].reverse(),
                        {thrust:this.thrust, load: this.load, friction:this.friction});
                    basicSegments.push(seg);
                }


            }


            initSlope = linRes[0][1];

            seg = BasicSegment.CreateBasicSegment(master[currentRow-1],master[currentRow],linRes[0].reverse(),
                        {thrust:this.thrust, load: this.load, friction:this.friction});
            
            basicSegments.push(seg);
            //result = result.concat(linRes);
            cubicStart = currentRow;
        }

        currentRow++;
    }


    // there may be 'leftover' cubic segments
    //current row is passed the last row now, so need to subtract one to get to actual number of segments
    cubicSegs = currentRow - 1 - cubicStart;


    cubicMasters=master.slice(cubicStart, cubicStart + cubicSegs + 1);
    if (cubicSegs > 0) {
        coeffs3 = this.calculateCubic(cubicMasters,
            slave.slice(cubicStart, cubicStart + cubicSegs + 1),
            initSlope,
            finalSlope);

        //result = result.concat(coeffs3);

        for (i = 0; i < coeffs3.length; i++) {
            seg = BasicSegment.CreateBasicSegment(cubicMasters[i],cubicMasters[i+1],coeffs3[i].reverse(),
                {thrust:this.thrust, load: this.load, friction:this.friction});
            basicSegments.push(seg);
        }

    }

    //return result;

    return basicSegments;    

};



CamMotionSegment.prototype.exportData = function() {

    var dataObj=MotionSegment.MotionSegment.prototype.exportData.call(this);
    dataObj.type="CamMotionSegment";

    return dataObj;
};


CamMotionSegment.prototype.importFromData = function(data) {
    if(data.constructor=="CamMotionSegment") {
        var prevTime=data.master[0];
        var prevPosition=data.slave[0];
        var prevVelocity = data.initialSlope;
        var camSeg = new CamMotionSegment(prevTime,prevPosition,prevVelocity);

        return camSeg;
    }

    throw new Error("CamMotionSegment is expecting to have eponymously named constructor");
};



factory.calculateCubic = CamMotionSegment.prototype.calculateCubic;
factory.calculateLinear = CamMotionSegment.prototype.calculateLinear;
factory.calculateBasicSegments = CamMotionSegment.prototype.calculateBasicSegments;
factory.InterpolationEnum = InterpolationEnum;
factory.CamMotionSegment = CamMotionSegment;
factory.CamTable=CamTable;

/**
 * creates new  cam segment using default values ala MA7
 * @param {numbewr} prevTime previous segment's final time
 * @param {number} prevPosition previous segment's final position
 * @param {number} prevVelocity previous segments' final velocity
 */
factory.createCamSegment=function(prevTime, prevPosition, prevVelocity,loads){
    return new CamMotionSegment(prevTime,prevPosition,prevVelocity,loads);
};

module.exports=factory;

},{"../util/fastMath":12,"../util/util":16,"./basicSegment":5,"./motionSegment":9,"numeric":17}],7:[function(require,module,exports){
var MotionSegment = require('./motionSegment');
var basicSegmentFactory = require('./basicSegment');
var AccelSegment = require('./accelSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var factory = {};

/**
 * IndexMotion segment constructor
 * @param {Array} basicSegments [array of basic segments]
 */
var IndexMotionSegment = function(basicSegments) {
	if (!Array.isArray(basicSegments))
		throw new Error('Expecting an array parameter');
	if (basicSegments.length < 1 || basicSegments.length > 7)
		throw new Error('Expecting aray length to be at least one, but less than or equal to 7');

	var t0 = basicSegments[0].initialTime;
	var tf = basicSegments[basicSegments.length - 1].finalTime;

	MotionSegment.MotionSegment.call(this, t0, tf);

	for (var i = 1; i < basicSegments.length; i++) {
		if (basicSegments[i].finalTime <= basicSegments[i - 1].finalTime) {
			throw new Error('time mismatch in index segment');
		}
	}

	this.type = 'index';

	// each segment (regardless of type) has initialTime and finalTime
	this.initialTime = basicSegments[0].initialTime;
	this.finalTime = basicSegments[basicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(basicSegments);
};


IndexMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
IndexMotionSegment.prototype.constructor = IndexMotionSegment;


IndexMotionSegment.prototype.exportData = function () {
	
	var dataObj = MotionSegment.MotionSegment.prototype.exportData.call(this);
	dataObj.type = 'IndexMotionSegment';

	return dataObj;
};


IndexMotionSegment.prototype.importFromData = function (data) {
	if (data.constructor === "IndexSegment") {
		return new IndexSegment(
			data.initialTime, // t0
			data.finalTime, // tf
			data.initialPosition, // p0
			data.finalPosition, // pf
			data.initialVelocity, // v
			data.velLimPos,
			data.velLimNeg,
			data.accJerk,
			data.decJerk,
			data.xSkew,
			data.ySkew,
			data.shape,
			data.mode,
			data.loads);
	}

	throw new Error("Unknown IndexSegment type: " + data.constructor);
};


IndexMotionSegment.prototype.setBasicSegmentLoads = function(loads) {
	if (!loads)
		return;
	var segments = this.getAllSegments();

	for (var i = segments.length - 1; i >= 0; i--) {
		segments[i].friction = loads.friction || 0;
		segments[i].thrust = loads.thrust || 0;
		segments[i].load = loads.load || 0;
	}
};


var IndexSegment = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode, loads) {

	if (mode !== "absolute")
		mode = "incremental";

	var loads_copy = {};
	Util.extend(loads_copy, loads);

	this.segmentData = {
		initialTime: t0,
		finalTime: tf,
		duration: tf - t0,
		initialVelocity: v,
		finalVelocity: v,
		initialPosition: p0,
		finalPosition: pf,
		// distance: pf-p0,
		velLimNeg: velLimNeg,
		velLimPos: velLimPos,
		accJerk: accJerk,
		decJerk: decJerk,
		xSkew: xSkew,
		ySkew: ySkew,
		shape: shape,
		mode: mode,
		loads: loads_copy
	};

	var basicSegments = this.calculateBasicSegments(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape);

	IndexMotionSegment.call(this, basicSegments);
	this.setBasicSegmentLoads(loads_copy);
};


IndexSegment.prototype = Object.create(IndexMotionSegment.prototype);
IndexSegment.prototype.constructor = IndexSegment;


/**
 * Calculates and creates the 1 to 7 basic segments that IndexSegment consists of
 * @param  {Number} t0   		[initial time]
 * @param  {Number} tf   		[finalt time]
 * @param  {Number} p0   		[initial position]
 * @param  {Number} pf   		[final position]
 * @param  {Number} v    		[start and end velocity]
 * @param  {Number} velLimPos 	[positive velocity limit (null/Inf if not applicable) <0,Inf>]
 * @param  {Number} velLimNeg	[negative velocity limit (null/-Inf if not applicable) <-Inf, 0>]
 * @param  {Number} accJerk 	[percent jerk applied to the first trapezoid <0,1>. This value applies to the first trapzeoid regardless of whether or not it is accel or decel.]
 * @param  {Number} decJerk   	[percent jerk applied to the second trapezoid <0,1>]
 * @param  {Number} xSkew		[time skew <-1,1>]
 * @param  {Number} ySkew 		[velocity skew <-1,1>]
 * @param  {String} shape		[shape of the velocity profile ("trapezoid", "triangle")]
 * @return {Array}				[Array of BasicSegment]
 */
IndexSegment.prototype.calculateBasicSegments = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape) {

	/**
	 * yskew affects the maximum velocity. limiting the maximum velocity or minimum velocity is the same as modifying the yskew. velocity
	 * limits override the yskew value.
	 */
	if (shape == "triangle") {
		ySkew = 1;
	} else if (ySkew === null) {
		ySkew = 0.5;
	}

	/**
	 * the xskew does NOT affect the size of the coast segment. it only affects how the total acceldecel time is split between the accel and decel curve
	 */
	if (xSkew === null)
		xSkew = 0;

	var dp = pf - p0;
	var dt = tf - t0;
	// var s = dp/abs(dp); // sign of position change
	var v_ave = dp / dt - v; // average velocity
	var vmax = v + (1 + ySkew) * v_ave; // max velocity

	// if calculated vm is outside velocity bounds, correct ySkew and vmax
	if (velLimPos !== null && vmax > velLimPos) {
		ySkew = (velLimPos - v) / v_ave - 1;
		vmax = velLimPos;
		throw new Error('Maximum velocity exceeds positive velocity limit. Changing ySkew.'); // this should probably be changed to a real error/warning.
	} else if (velLimNeg !== null && vmax < velLimNeg) {
		ySkew = (velLimNeg - v) / v_ave - 1;
		vmax = velLimNeg;
		throw new Error('Maximum velocity exceeds negative velocity limit. Changing ySkew.');
	}

	// we may have just thrown yskew out of bounds
	if (ySkew > 1 || ySkew < 0)
		throw new Error('Conflict between y skew and maximum velocity');

	// apply ySkew
	var modifiedYSkew = 1 - 1 / (1 + ySkew);
	var accdec_time = modifiedYSkew * dt * 2;
	var coast_time = dt - accdec_time;

	// apply xSkew
	var acc_time = accdec_time / 2 * (1 + xSkew);
	var dec_time = dt - acc_time - coast_time;

	var outputSegs = [];

	// accel segment
	var nextPosition;
	if (acc_time > 0) {
		outputSegs = [].concat(outputSegs, AccelSegment.calculateTimeVelocityBasicSegments(t0, t0 + acc_time, p0, v, vmax, accJerk));
		nextPosition = outputSegs[outputSegs.length - 1].evaluatePositionAt(t0 + acc_time);
		// console.log(nextPosition);
	} else {
		nextPosition = p0;
	}

	// there may be a significant problem with this code. WHat happens if we have a triangle and jerks match??? There's only 3 segments.
	// This code produces four though. Need to consider if this is going to be an issue. I don't think it will be though. -Brian G. Mar 16 2017

	// Create coast basic segment
	if (coast_time > 0) {
		outputSegs = [].concat(outputSegs, basicSegmentFactory.CreateBasicSegment(t0 + acc_time, t0 + acc_time + coast_time, [0, 0, vmax, nextPosition]));
		nextPosition = outputSegs[outputSegs.length - 1].evaluatePositionAt(t0 + acc_time + coast_time);
	}

	// decel segment
	outputSegs = [].concat(outputSegs, AccelSegment.calculateTimeVelocityBasicSegments(t0 + acc_time + coast_time, tf, nextPosition, vmax, v, decJerk));

	return outputSegs;
};



/**
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * Modification takes into account absolute vs incremental mode
 * @param {float} t0 new initial time
 * @param {float} a0 new initial acceleration
 * @param {float} v0 new initial velocity
 * @param {float} p0 new initial position
 */
IndexSegment.prototype.modifyInitialValues = function(t0, a0, v0, p0) {

	var tf;
	var pf;
	if (this.segmentData.mode === "incremental") {
		tf = t0 + this.segmentData.duration;
		pf = p0 + this.segmentData.finalPosition - this.segmentData.initialPosition;
	} else {
		tf = this.segmentData.finalTime;
		pf = this.segmentData.finalPosition;
		this.segmentData.duration = tf - t0;
		if (fastMath.lt(this.segmentData.duration, 0))
			throw new Error('tried to move initial time past final time for absolute segment');
	}

	var newBasicSegments = this.calculateBasicSegments(t0,
		tf,
		p0,
		pf,
		v0,
		this.segmentData.velLimPos,
		this.segmentData.velLimNeg,
		this.segmentData.accJerk,
		this.segmentData.decJerk,
		this.segmentData.xSkew,
		this.segmentData.ySkew,
		this.segmentData.shape
	);

	this.initialTime = newBasicSegments[0].initialTime;
	this.finalTime = newBasicSegments[newBasicSegments.length - 1].finalTime;

	this.segments.initializeWithSegments(newBasicSegments);

	return this;
};


/**
 * Edit user entered segment values
 * @param  {Object} newSegmentData      new user entered data
 * @param {Object} initialConditions initial conditions
 */
IndexSegment.prototype.modifySegmentValues = function(newSegmentData, initialConditions) {

	if (newSegmentData.mode !== "absolute")
		newSegmentData.mode = "incremental";

	// consider replacing all this junk with _.mergeWith
	this.segmentData.mode = newSegmentData.mode || this.segmentData.mode;
	this.segmentData.initialTime = initialConditions.time || this.segmentData.initialTime;
	this.segmentData.finalTime = newSegmentData.finalTime || this.segmentData.finalTime;
	this.segmentData.initialVelocity = initialConditions.velocity || this.segmentData.initialVelocity;
	this.segmentData.finalVelocity = initialConditions.velocity || this.segmentData.finalVelocity;
	this.segmentData.initialPosition = initialConditions.position || this.segmentData.initialPosition;
	this.segmentData.finalPosition = newSegmentData.finalPosition || this.segmentData.finalPosition;
	this.segmentData.velLimNeg = newSegmentData.velLimNeg || this.segmentData.velLimNeg;
	this.segmentData.velLimPos = newSegmentData.velLimPos || this.segmentData.velLimPos;
	this.segmentData.accJerk = newSegmentData.accJerk || this.segmentData.accJerk;
	this.segmentData.decJerk = newSegmentData.decJerk || this.segmentData.decJerk;
	this.segmentData.xSkew = newSegmentData.xSkew || this.segmentData.xSkew;
	this.segmentData.ySkew = newSegmentData.ySkew || this.segmentData.ySkew;
	this.segmentData.shape = newSegmentData.shape || this.segmentData.shape;

	this.segmentData.duration = this.segmentData.finalTime - this.segmentData.initialTime;
	this.segmentData.loads = {};
	Util.extend(this.segmentData.loads, newSegmentData.loads);

	var newBasicSegments = this.calculateBasicSegments(this.segmentData.initialTime,
		this.segmentData.finalTime,
		this.segmentData.initialPosition,
		this.segmentData.finalPosition,
		this.segmentData.initialVelocity,
		this.segmentData.velLimPos,
		this.segmentData.velLimNeg,
		this.segmentData.accJerk,
		this.segmentData.decJerk,
		this.segmentData.xSkew,
		this.segmentData.ySkew,
		this.segmentData.shape
	);

	this.segments.initializeWithSegments(newBasicSegments);
	this.setBasicSegmentLoads(newSegmentData.loads);

	return this;
};


/**
 * Makes a new IndexMotionSegment given velocity information
 * @param {Number} t0 				[initial time]
 * @param {Number} tf 				[final time]
 * @param {Number} p0 				[initial position]
 * @param {Number} pf 				[final position]
 * @param {Number} v 				[initial/final velocity]
 * @param {Number} velLimPos		[positive velocity limit]
 * @param {Number} velLimNeg		[negative velocity limit]
 * @param {Number} accJerk			[acc curve jerk percent]
 * @param {Number} decJerk			[dec curve jerk percent]
 * @param {Number} xSkew			[x skew value <-1,1>]
 * @param {Number} ySkew			[y skew value <0,1>]
 * @param {string} shape			[triangle or trapezoid]
 * @param {string} mode				[incremental or absolute]
 * @returns {IndexMotionSegment}	[freshly created index segment]
 */
factory.Make = function(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode, loads) {
	// data validation
	if (Util.isUndefined(accJerk) || accJerk < 0 || accJerk > 1)
		throw new Error('expecting accel jerk between <0,1>');

	if (Util.isUndefined(decJerk) || decJerk < 0 || decJerk > 1)
		throw new Error('expecting decel jerk between <0,1>');

	if (xSkew < -1 || xSkew > 1)
		throw new Error('expecting xSkew between <-1,1>');

	if (ySkew < 0 || ySkew > 1)
		throw new Error('expecting ySkew between <0,1>');

	if (tf < t0)
		throw new Error('expecting tf to come after t0');

	if ((pf - p0) < 0)
		throw new Error('expecting nonzero position change');

	if (Util.isUndefined(velLimPos) && velLimPos > v)
		throw new Error('expecting positive velocity limit to be greater than v or null');

	if (Util.isUndefined(velLimNeg) && velLimNeg < v)
		throw new Error('expecting positive velocity limit to be greater than v or null');

	var indexSegment = new IndexSegment(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode, loads);

	return indexSegment;
};


factory.IndexMotionSegment = IndexMotionSegment;

module.exports=factory;
},{"../util/fastMath":12,"../util/util":16,"./accelSegment":4,"./basicSegment":5,"./motionSegment":9}],8:[function(require,module,exports){
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
},{"../util/fastMath":12,"../util/polynomial":14,"../util/util":16,"./segment":10}],9:[function(require,module,exports){
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


MotionSegment.prototype.exportData = function() {
	var dataObj = {};

	Util.extend(dataObj, this.segmentData);
	dataObj.constructor = this.constructor.name;

	return dataObj;

};

MotionSegment.prototype.importFromData = function(data) {
	throw new Error("importFromData() function needs to be defined on derived segments!");
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
	if(segment.type !== "basic")
		return segment.evaluatePositionAt(x);
	else
		return segment.positionPoly.evaluateAt(x);

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


MotionSegment.prototype.getAllSegments = function() {
	return this.segments.getAllSegments();
};



/**
 * Calculates final time, acceleration, velocity and position for this segment
 * @return {Array} [tf,af,vf,pf]
 */
MotionSegment.prototype.getFinalValues = function() {
	var last = this.segments.lastSegment();
	var tf = last.finalTime;
	var af = last.evaluateAccelerationAt(tf);
	var vf = last.evaluateVelocityAt(tf);
	var pf = last.evaluatePositionAt(tf);

	return [tf, af, vf, pf];
};


/**
 * Calculates initial time, acceleration, velocity and position for this segment
 * @return {Array} [tf,af,vf,pf]
 */
MotionSegment.prototype.getInitialValues = function() {
	var last = this.segments.firstSegment();
	var t0 = last.initialTime;
	var a0 = last.evaluateAccelerationAt(t0);
	var v0 = last.evaluateVelocityAt(t0);
	var p0 = last.evaluatePositionAt(t0);

	return [t0, a0, v0, p0];
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
},{"../util/fastMath":12,"../util/util":16,"./segment":10,"./segmentStash":11}],10:[function(require,module,exports){
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
},{}],11:[function(require,module,exports){
/**
 * SegmentStash is the backing data structure for low level segment operations.
 * A motion profile is really a sorted array of Segments. Some Segments may contain other Segments
 *
 * Also, in order to speed up search and insert/delete operation, two data structures are used:
 * linked list - insert
 * hashmap(array) - searching
 *
 */

var FastMath=require('../util/fastMath');
var LinkedList=require('../util/linkedList');


var SegmentStash = function() {

	/**
	 * [nodesHash description]
	 * @type {Object} associative array of nodes. Each node contains a motion or load segment
	 */
	this.nodesHash = {};

	this.segmentsList = LinkedList.makeLinkedList();
};

/**
 * Inserts a segment in front of another segment identified by segmentId
 * @param {Segment} segment   Segment to insert
 * @param {integer} segmentId segment Id of segment to insert in front of. If null, add at the end
 */
SegmentStash.prototype.insertAt = function(segment, segmentId) {
	if (!segment)
		throw new Error("Insert expects segment to be not null!");

	var newNode;

	if (segmentId) { //there needs to be an existing node with this id
		var existingNode = this.nodesHash[segmentId];
		if (!existingNode)
			return null;

		newNode = this.segmentsList.insertAt(existingNode, segment);

	} else {
		newNode = this.segmentsList.add(segment);
	}

	this.nodesHash[segment.id] = newNode;
	return segment;
};


SegmentStash.prototype.findById = function(segmentId) {
	var node = this.nodesHash[segmentId];
	if (node)
		return this.nodesHash[segmentId].data;
};


SegmentStash.prototype.getNextSegment = function(segmentId) {
	var node = this.nodesHash[segmentId];
	if (node && node.next)
		return node.next.data;
	return null;
};


SegmentStash.prototype.getPreviousSegment = function(segmentId) {
	var node = this.nodesHash[segmentId];
	if (node && node.previous)
		return node.previous.data;
	return null;
};


/**
 * Gets all segments currently in the stash
 * @returns {Array} array of Segment
 */
SegmentStash.prototype.getAllSegments = function() {

	return this.segmentsList.getDataArray();
};


/**
 * Clears all segments in the stash
 */
SegmentStash.prototype.clearAllSegments = function() {
	this.nodesHash = {};
	this.segmentsList.clearAll();
};


/**
 * Deletes segment specified by segment id
 * @param {Number} segmentId
 */
SegmentStash.prototype.delete = function(segmentId) {
	if (!FastMath.isNumeric(segmentId) || FastMath.lt(0))
		throw new Error("Delete expects id to be a number >=0");

	var nodeToDel = this.nodesHash[segmentId];
	if (!nodeToDel)
		return null;

	var deletedNode = nodeToDel;
	delete this.nodesHash[segmentId];

	this.segmentsList.removeNode(nodeToDel);

	return nodeToDel.data;
};


/**
 * Gets the last segment
 * @return {Segment} last segment in the list
 */
SegmentStash.prototype.lastSegment = function() {
	if (this.segmentsList.tail)
		return this.segmentsList.tail.data;
	return null;
};


SegmentStash.prototype.firstSegment = function() {
	if (this.segmentsList.head)
		return this.segmentsList.head.data;
	return null;
};


SegmentStash.prototype.countSegments = function() {
	return this.segmentsList.length();
};


/**
 * Find segment within the stash that starts with the specified time
 * @param  {Number} initialTime initial time
 * @return {Segment}             segment that starts with the specified initial time
 */
SegmentStash.prototype.findSegmentWithInitialTime = function(initialTime) {


	var currentNode = this.segmentsList.head;


	// 2nd use-case: a valid position
	while (currentNode) {


		if (FastMath.equal(initialTime, currentNode.data.initialTime))
			return currentNode.data;

		currentNode = currentNode.next;
	}


	return null;
};


/**
 * Finds segment that has initialTime or finalTime inside of it
 * @param  {Number} initialTime     [description]
 * @param  {Number} finalTime       [description]
 * @return {Segment}            	 found segment
 */
SegmentStash.prototype.findOverlappingSegment = function(initialTime,finalTime) {

	var currentNode = this.segmentsList.head;


	// 2nd use-case: a valid position
	while (currentNode) {

		//case 1 - new segment final time falls into an existing segment
		if (FastMath.gt(finalTime, currentNode.data.initialTime) &&
			FastMath.leq(finalTime,currentNode.data.finalTime))
			return currentNode.data;

		//case 2 - new segment initial time falls into an existing segment
		if (FastMath.geq(initialTime, currentNode.data.initialTime) &&
			FastMath.lt(initialTime,currentNode.data.finalTime))
			return currentNode.data;

		//case 3 - new segment fully envelopes an existing segment
		if(FastMath.geq(initialTime,currentNode.data.initialTime) &&
			FastMath.leq(finalTime,currentNode.data.finalTime))
			return currentNode.data;

		//case 4 - new segment falls within an existing segment
		if(FastMath.leq(initialTime,currentNode.data.initialTime) &&
			FastMath.geq(finalTime,currentNode.data.finalTime))
			return currentNode.data;

		currentNode = currentNode.next;
	}


	return null;
};


/**
 * Finds previous segment using initial time
 * @param  {Number} t0 initial time
 * @return {Segment}    previous segment
 */
SegmentStash.prototype.getPreviousByInitialTime = function(t0){
	var currentNode = this.segmentsList.head;


	// 2nd use-case: a valid position
	while (currentNode) {


		if (FastMath.leq(t0, currentNode.data.finalTime))
			return currentNode.data;

		currentNode = currentNode.next;
	}


	return null;
};


SegmentStash.prototype.initializeWithSegments = function(segments) {
	if (!Array.isArray(segments))
		throw new Error("expecting an array of Segments");

	this.clearAllSegments();

	for (var i = 0; i < segments.length; i++) {
		this.insertAt(segments[i], null);
	}
};


var factory = {};

factory.makeStash = function() {
	return new SegmentStash();
};

module.exports=factory;
},{"../util/fastMath":12,"../util/linkedList":13}],12:[function(require,module,exports){
var FastMath = function() {
	
};



var epsilon = 2.220446049250313e-16;

FastMath.prototype.epsilon = epsilon;


FastMath.prototype.equal = function(a, b) {
	return this.abs(a - b) < (epsilon);

};

FastMath.prototype.notEqual = function(a, b) {
	return !this.equal(a, b);
};

FastMath.prototype.leq = function(a, b) {
	return a < b || this.equal(a, b);
};

FastMath.prototype.geq = function(a, b) {
	return a > b || this.equal(a, b);
};

FastMath.prototype.lt = function(a, b) {
	return a < b && !this.equal(a, b);
};

FastMath.prototype.gt = function(a, b) {
	return a > b && !this.equal(a, b);
};

FastMath.prototype.max = function(a, b) {
	if (a > b) {
		return a;
	}

	return b;
};

FastMath.prototype.min = function(a, b) {
	if (a < b) {
		return a;
	}

	return b;
};

FastMath.prototype.abs = function(a) {
	if (a < 0) {
		return -a;
	}

	return a;
};

FastMath.prototype.sign = function(a) {
	if (a < 0) {
		return -1;
	}

	if (a > 0) {
		return 1;
	}

	return 0;
};

FastMath.prototype.sqr = function(x) {
	return x * x;
};

FastMath.prototype.trunc = function(a) {
	var num = parseInt(a, 10);
	if (isNaN(num)) {
		return NaN;
	}

	return parseInt(num.toFixed(0), 10);
};

FastMath.prototype.fix = function(a, p) {
	var num = parseFloat(a);
	if (isNaN(num)) {
		return NaN;
	}

	p = parseInt(p, 10);
	if (isNaN(p)) {
		p = 0;
	}

	return parseFloat(num.toFixed(p));
};
/**
 * Returns true if parameter is numeric
 * @param  {object}  n object to test
 * @return {Boolean}   true if object is numeric
 */
FastMath.prototype.isNumeric = function(n) {
	if (arguments.length != 1)
		throw new Error('isNumeric expects one parameter');
	return !isNaN(parseFloat(n)) && isFinite(n);
};

/**
 * Determines if all members of array are numeric
 * @return {Boolean}      true if all array members are numeric
 */
FastMath.prototype.areNumeric = function() {

	var argLength = arguments.length;
	if (argLength === 0)
		return false;

	for (var i = 0; i < argLength; i++) {
		if (!this.isNumeric(arguments[i]))
			return false;
	}
	return true;
};

/**
 * Helper function to be used when comparing numbers
 * @param  {Number} a first number
 * @param  {Number} b second number
 * @return {Number}   positive if a>b, negative if a<b, zero if a==b
 */
FastMath.prototype.compareNumbers = function(a, b) {

	//not using straight a-b comparison here in order to avoid
	//rounding errors!
	if (this.gt(a, b))
		return 1;
	if (this.lt(a, b))
		return -1;

	return 0;
};

/**
 * Performs a binary search on the host array. This method can either be
 * injected into Array.prototype or called with a specified scope like this:
 * binaryIndexOf.call(someArray, searchElement);
 *
 * Courtesy of http://oli.me.uk/2013/06/08/searching-javascript-arrays-with-a-binary-search/
 *
 * usage: var index = binaryIndexOf.call(models, someModel);
 * 
 * @param {*} searchElement The item to search for within the array.
 * @return {Number} The index of the element which defaults to -1 when not found.
 */
FastMath.prototype.binaryIndexOf = function(searchElement) {

	var minIndex = 0;
	var maxIndex = this.length - 1;
	var currentIndex;
	var currentElement;
	var resultIndex;

	while (minIndex <= maxIndex) {
		resultIndex = currentIndex = (minIndex + maxIndex) / 2 | 0;
		currentElement = this[currentIndex];

		if (currentElement < searchElement) {
			minIndex = currentIndex + 1;
		} else if (currentElement > searchElement) {
			maxIndex = currentIndex - 1;
		} else {
			return currentIndex;
		}
	}

	return ~maxIndex;
};
FastMath.prototype.binaryIndexOfObject = function(searchElement, accessor) {

	var minIndex = 0;
	var maxIndex = this.length - 1;
	var currentIndex;
	var currentElement;
	var resultIndex;

	while (minIndex <= maxIndex) {
		resultIndex = currentIndex = (minIndex + maxIndex) / 2 | 0;
		currentElement = this[currentIndex];

		var current = accessor.call(currentElement);
		var search = searchElement;

		if (current < search) {
			minIndex = currentIndex + 1;
		} else if (current > search) {
			maxIndex = currentIndex - 1;
		} else {
			return currentIndex;
		}
	}

	return ~maxIndex;
};



module.exports = new FastMath();
},{}],13:[function(require,module,exports){
/**
 * Node of the linked list
 * @param {Ojbect} data data object
 */
var Node = function(data) {
	this.data = data;
	this.next = null;
	this.previous = null;
};


/**
 * Double linked list functionality
 * some code swiped from: https://code.tutsplus.com/articles/data-structures-with-javascript-singly-linked-list-and-doubly-linked-list--cms-23392
 */
var LinkedList = function() {
	this._length = 0;
	this.head = null;
	this.tail = null;
};
/**
 * Add a value at the end of the list
 * @param {Object} value value to add
 */
LinkedList.prototype.add = function(value) {
	var node = new Node(value);

	if (this._length) {
		this.tail.next = node;
		node.previous = this.tail;
		this.tail = node;
	} else {
		this.head = node;
		this.tail = node;
	}

	this._length++;

	return node;
};


LinkedList.prototype.clearAll = function() {
	this._length = 0;
	this.head = null;
	this.tail = null;
};


/**
 * Inserts into the list using an existing node
 * @param  {Node} existing existing Node
 * @param  {Object} data     new data to insert before existing node
 * @return {Node}          new node that was inserted
 */
LinkedList.prototype.insertAt = function(existing, data) {
	var node = new Node(data);
	var next = existing.next;
	var prev = existing.previous;

	node.next = existing;
	existing.previous = node;

	// if there is a previous node, wire it up
	if (prev) {
		prev.next = node;
		node.previous = prev;
	} else {
		// if there is not a previous node, we are inserting a new first node, thus 
		// head must be modified
		this.head = node;
	}


	this._length++;
	return node;

};


/**
 * Removes nodes specified by the parameter
 * @param  {Node} node Node to remove
 * @return {Node}      removed node
 */
LinkedList.prototype.removeNode = function(node) {
	if (!(node instanceof Node))
		throw new Error('removeNode: expecting a Node as parameter type');

	var next = node.next;
	var prev = node.previous;

	//this could be the last node
	if (next)
		next.previous = prev;

	//could be the first node
	if (prev)
		prev.next = next;
	else
		this.head = next;

	var nodeToRemove = node;
	node = null;

	this._length--;

	return nodeToRemove;

};


/**
 * Returns current length of the linked list
 */
LinkedList.prototype.length = function() {
	return this._length;
};


/**
 * Gets all nodes currently in the list
 * @returns {Array} array of all nodes in the list
 */
LinkedList.prototype.getAllNodes = function() {
	var result = [];

	var currentNode = this.head;

	while (currentNode) {
		result.push(currentNode);
		currentNode = currentNode.next;
	}


	return result;
};



/**
 * Gathers data from all nodes into an array
 * @returns {Array} array of all nodes in the list
 */
LinkedList.prototype.getDataArray = function() {
	var result = [];

	var currentNode = this.head;

	while (currentNode) {
		result.push(currentNode.data);
		currentNode = currentNode.next;
	}


	return result;
};



/**
 * Get node at the specified position
 * @param  {Number} position position to get node at
 * @return {Node}          Node at specified position
 */
LinkedList.prototype.searchNodeAt = function(position) {
	var currentNode = this.head,
		length = this._length,
		count = 1,
		message = {
			failure: 'Failure: non-existent node in this list.'
		};

	// 1st use-case: an invalid position
	if (length === 0 || position < 1 || position > length) {
		throw new Error(message.failure);
	}

	// 2nd use-case: a valid position
	while (count < position) {
		currentNode = currentNode.next;
		count++;
	}

	return currentNode;
};



/**
 * Removes node at specified position
 * @param  {Number} position node at this position will be deleted
 * @return {Object}          Deleted node
 */
LinkedList.prototype.remove = function(position) {
	var currentNode = this.head,
		length = this._length,
		count = 1,
		message = {
			failure: 'Failure: non-existent node in this list.'
		},
		beforeNodeToDelete = null,
		nodeToDelete = null,
		deletedNode = null;

	// 1st use-case: an invalid position
	if (length === 0 || position < 1 || position > length) {
		throw new Error(message.failure);
	}

	// 2nd use-case: the first node is removed
	if (position === 1) {
		this.head = currentNode.next;
		deletedNode = currentNode;

		// 2nd use-case: there is a second node
		if (!this.head) {
			this.head.previous = null;
			// 2nd use-case: there is no second node
		} else {
			this.tail = null;
		}

		this._length--;

		return deletedNode;

	}

	// 3rd use-case: the last node is removed
	if (position === this._length) {
		deletedNode = this.tail;
		this.tail = this.tail.previous;
		this.tail.next = null;

		this._length--;
		return deletedNode;

	}

	// 4th use-case: a middle node is removed

	while (count < position) {
		currentNode = currentNode.next;
		count++;
	}

	beforeNodeToDelete = currentNode.previous;
	nodeToDelete = currentNode;
	var afterNodeToDelete = currentNode.next;

	beforeNodeToDelete.next = afterNodeToDelete;
	afterNodeToDelete.previous = beforeNodeToDelete;
	deletedNode = nodeToDelete;
	nodeToDelete = null;


	this._length--;

	return deletedNode;
};


var factory = {};

/**
 * Creates a new linked list
 */
factory.makeLinkedList = function() {
	return new LinkedList();
};


module.exports = factory;
},{}],14:[function(require,module,exports){
var FastMath = require('./fastMath');
var factory = {};


/**
 * Polynomial of max 3rd degree
 * @param {Array} coeffArray [description]
 * @param {double} startPoint Point on the X-axis where to start evaluating
 * @param {double} endPoint where on x-axis does the evaluation stop
 */
var Polynomial = function(coeffArray, startPoint, endPoint) {

    this.A = coeffArray[3];
    this.B = coeffArray[2];
    this.C = coeffArray[1];
    this.D = coeffArray[0];
    this.startPoint = startPoint;
    this.endPoint = endPoint;

};


Polynomial.prototype.evaluateAt = function(x) {
    if (FastMath.lt(x, this.startPoint))
        throw new Error('Trying to evalute polynomial with x value less than the start point');
    if (FastMath.gt(x, this.endPoint))
        throw new Error('Trying to evaluate polynomial with x value greater than the end point');
    return this.A * Math.pow(x - this.startPoint, 3) + this.B * Math.pow(x - this.startPoint, 2) + this.C * (x - this.startPoint) + this.D;
};


/**
 * Takes derivative of this polynomial and returns a new polynomial
 * @returns {Polynomial} a new polynomial
 */
Polynomial.prototype.derivative = function() {
    var b = 3 * this.A;
    var c = 2 * this.B;
    var d = this.C;

    return new Polynomial([d, c, b, 0], this.startPoint, this.endPoint);
};

/**
 * Calculate cubic roots - props to http://stackoverflow.com/a/27176424/1579778
 */
Polynomial.prototype.roots = function() {

    var that = this;
    var roots = calculateCubicRoots(this.A, this.B, this.C, this.D);
    return roots.filter(function(value) {

        if (FastMath.geq(value, that.startPoint) && FastMath.leq(value, that.endPoint))
            return true;
    });

};



Polynomial.prototype.toPrettyString = function() {
    return this.this.A + '(x-' + this.startPoint + ')^3 + ' + this.B + '(x-' + this.startPoint + ')^2 + ' + this.C + '(x-' + this.startPoint + ')' + this.D;
};



var cuberoot = function cuberoot(x) {
    var y = Math.pow(Math.abs(x), 1 / 3);
    return x < 0 ? -y : y;
};


var calculateCubicRoots = function(a, b, c, d) {
    var D;
    var u;

    if (Math.abs(a) < 1e-8) { // Quadratic case, ax^2+bx+c=0
        a = b;
        b = c;
        c = d;
        if (Math.abs(a) < 1e-8) { // Linear case, ax+b=0
            a = b;
            b = c;
            if (Math.abs(a) < 1e-8) // Degenerate case
                return [];
            return [-b / a];
        }

        D = b * b - 4 * a * c;
        if (Math.abs(D) < 1e-8)
            return [-b / (2 * a)];
        else if (D > 0)
            return [(-b + Math.sqrt(D)) / (2 * a), (-b - Math.sqrt(D)) / (2 * a)];
        return [];
    }

    // Convert to depressed cubic t^3+pt+q = 0 (subst x = t - b/3a)
    var p = (3 * a * c - b * b) / (3 * a * a);
    var q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a);
    var roots;

    if (Math.abs(p) < 1e-8) { // p = 0 -> t^3 = -q -> t = -q^1/3
        roots = [cuberoot(-q)];
    } else if (Math.abs(q) < 1e-8) { // q = 0 -> t^3 + pt = 0 -> t(t^2+p)=0
        roots = [0].concat(p < 0 ? [Math.sqrt(-p), -Math.sqrt(-p)] : []);
    } else {
        D = q * q / 4 + p * p * p / 27;
        if (Math.abs(D) < 1e-8) { // D = 0 -> two roots
            roots = [-1.5 * q / p, 3 * q / p];
        } else if (D > 0) { // Only one real root
            u = cuberoot(-q / 2 - Math.sqrt(D));
            roots = [u - p / (3 * u)];
        } else { // D < 0, three roots, but needs to use complex numbers/trigonometric solution
            u = 2 * Math.sqrt(-p / 3);
            var t = Math.acos(3 * q / p / u) / 3; // D < 0 implies p < 0 and acos argument in [-1..1]
            var k = 2 * Math.PI / 3;
            roots = [u * Math.cos(t), u * Math.cos(t - k), u * Math.cos(t - 2 * k)];
        }
    }

    // Convert back from depressed cubic
    for (var i = 0; i < roots.length; i++)
        roots[i] -= b / (3 * a);



    return roots;
};
/**
 * Creates a new  polynomial with coefficients A,B,C,D
 * Ax^3 + Bx^2 + Cx +D
 * @param {Array} coeffs [array of coefficients]
 * @param {double} startPoint where on x-axis does this poly start
 * @param {double} endPoint where on a x-axis does this poly end
 */
factory.createPolyAbCd = function(coeffs, startPoint, endPoint) {
    if (!Array.isArray(coeffs) || coeffs.length != 4)
        throw new Error('expecting parameter of type array and length 4');

    if (!FastMath.isNumeric(startPoint) || startPoint < 0)
        throw new Error('expecting a valid startpoint');

    if (!FastMath.isNumeric(endPoint) || endPoint <= startPoint)
        throw new Error('expecting valid endpoint');



    var poly = new Polynomial(coeffs.reverse(), startPoint, endPoint);

    return poly;

};

module.exports = factory;
},{"./fastMath":12}],15:[function(require,module,exports){
    var UndoManager = require('undo-manager'); // require the lib from node_modules
    var singleton;

    if (!singleton) {
        singleton = new UndoManager();
    }

    module.exports = singleton;
},{"undo-manager":18}],16:[function(require,module,exports){
	/**
	 * Object Extending Functionality
	 * https://gist.github.com/bhavyaw/25b115603630ebf2271d
	 */
	var extend = function(out) {
		  out = out || {};
		  for (var i = 1; i < arguments.length; i++) {
		    if (!arguments[i])
		      continue;

		    for (var key in arguments[i]) {
		      if (arguments[i].hasOwnProperty(key))
		        out[key] = arguments[i][key];
		    }
		  }
		  return out;
	};

	// export CommonJS way
	exports.extend=extend;

	/**
	 * angular isObject shim
	 * @param  {Object}  obj object to check
	 * @return {Boolean}     true if object
	 */
	var isObject = function(obj) {
		return obj !== null && typeof obj ==='object';
	};

	exports.isObject = isObject;


	/**
	 * Mimics angular isUndefined functionality
	 * @param  {Object}  obj object to test
	 * @return {Boolean}     true if unefined
	 */
	var isUndefined = function(obj) {
		return typeof obj === 'undefined';
	}
	exports.isUndefined=isUndefined;
},{}],17:[function(require,module,exports){
(function (global){
"use strict";

var numeric = (typeof exports === "undefined")?(function numeric() {}):(exports);
if(typeof global !== "undefined") { global.numeric = numeric; }

numeric.version = "1.2.6";

// 1. Utility functions
numeric.bench = function bench (f,interval) {
    var t1,t2,n,i;
    if(typeof interval === "undefined") { interval = 15; }
    n = 0.5;
    t1 = new Date();
    while(1) {
        n*=2;
        for(i=n;i>3;i-=4) { f(); f(); f(); f(); }
        while(i>0) { f(); i--; }
        t2 = new Date();
        if(t2-t1 > interval) break;
    }
    for(i=n;i>3;i-=4) { f(); f(); f(); f(); }
    while(i>0) { f(); i--; }
    t2 = new Date();
    return 1000*(3*n-1)/(t2-t1);
}

numeric._myIndexOf = (function _myIndexOf(w) {
    var n = this.length,k;
    for(k=0;k<n;++k) if(this[k]===w) return k;
    return -1;
});
numeric.myIndexOf = (Array.prototype.indexOf)?Array.prototype.indexOf:numeric._myIndexOf;

numeric.Function = Function;
numeric.precision = 4;
numeric.largeArray = 50;

numeric.prettyPrint = function prettyPrint(x) {
    function fmtnum(x) {
        if(x === 0) { return '0'; }
        if(isNaN(x)) { return 'NaN'; }
        if(x<0) { return '-'+fmtnum(-x); }
        if(isFinite(x)) {
            var scale = Math.floor(Math.log(x) / Math.log(10));
            var normalized = x / Math.pow(10,scale);
            var basic = normalized.toPrecision(numeric.precision);
            if(parseFloat(basic) === 10) { scale++; normalized = 1; basic = normalized.toPrecision(numeric.precision); }
            return parseFloat(basic).toString()+'e'+scale.toString();
        }
        return 'Infinity';
    }
    var ret = [];
    function foo(x) {
        var k;
        if(typeof x === "undefined") { ret.push(Array(numeric.precision+8).join(' ')); return false; }
        if(typeof x === "string") { ret.push('"'+x+'"'); return false; }
        if(typeof x === "boolean") { ret.push(x.toString()); return false; }
        if(typeof x === "number") {
            var a = fmtnum(x);
            var b = x.toPrecision(numeric.precision);
            var c = parseFloat(x.toString()).toString();
            var d = [a,b,c,parseFloat(b).toString(),parseFloat(c).toString()];
            for(k=1;k<d.length;k++) { if(d[k].length < a.length) a = d[k]; }
            ret.push(Array(numeric.precision+8-a.length).join(' ')+a);
            return false;
        }
        if(x === null) { ret.push("null"); return false; }
        if(typeof x === "function") { 
            ret.push(x.toString());
            var flag = false;
            for(k in x) { if(x.hasOwnProperty(k)) { 
                if(flag) ret.push(',\n');
                else ret.push('\n{');
                flag = true; 
                ret.push(k); 
                ret.push(': \n'); 
                foo(x[k]); 
            } }
            if(flag) ret.push('}\n');
            return true;
        }
        if(x instanceof Array) {
            if(x.length > numeric.largeArray) { ret.push('...Large Array...'); return true; }
            var flag = false;
            ret.push('[');
            for(k=0;k<x.length;k++) { if(k>0) { ret.push(','); if(flag) ret.push('\n '); } flag = foo(x[k]); }
            ret.push(']');
            return true;
        }
        ret.push('{');
        var flag = false;
        for(k in x) { if(x.hasOwnProperty(k)) { if(flag) ret.push(',\n'); flag = true; ret.push(k); ret.push(': \n'); foo(x[k]); } }
        ret.push('}');
        return true;
    }
    foo(x);
    return ret.join('');
}

numeric.parseDate = function parseDate(d) {
    function foo(d) {
        if(typeof d === 'string') { return Date.parse(d.replace(/-/g,'/')); }
        if(!(d instanceof Array)) { throw new Error("parseDate: parameter must be arrays of strings"); }
        var ret = [],k;
        for(k=0;k<d.length;k++) { ret[k] = foo(d[k]); }
        return ret;
    }
    return foo(d);
}

numeric.parseFloat = function parseFloat_(d) {
    function foo(d) {
        if(typeof d === 'string') { return parseFloat(d); }
        if(!(d instanceof Array)) { throw new Error("parseFloat: parameter must be arrays of strings"); }
        var ret = [],k;
        for(k=0;k<d.length;k++) { ret[k] = foo(d[k]); }
        return ret;
    }
    return foo(d);
}

numeric.parseCSV = function parseCSV(t) {
    var foo = t.split('\n');
    var j,k;
    var ret = [];
    var pat = /(([^'",]*)|('[^']*')|("[^"]*")),/g;
    var patnum = /^\s*(([+-]?[0-9]+(\.[0-9]*)?(e[+-]?[0-9]+)?)|([+-]?[0-9]*(\.[0-9]+)?(e[+-]?[0-9]+)?))\s*$/;
    var stripper = function(n) { return n.substr(0,n.length-1); }
    var count = 0;
    for(k=0;k<foo.length;k++) {
      var bar = (foo[k]+",").match(pat),baz;
      if(bar.length>0) {
          ret[count] = [];
          for(j=0;j<bar.length;j++) {
              baz = stripper(bar[j]);
              if(patnum.test(baz)) { ret[count][j] = parseFloat(baz); }
              else ret[count][j] = baz;
          }
          count++;
      }
    }
    return ret;
}

numeric.toCSV = function toCSV(A) {
    var s = numeric.dim(A);
    var i,j,m,n,row,ret;
    m = s[0];
    n = s[1];
    ret = [];
    for(i=0;i<m;i++) {
        row = [];
        for(j=0;j<m;j++) { row[j] = A[i][j].toString(); }
        ret[i] = row.join(', ');
    }
    return ret.join('\n')+'\n';
}

numeric.getURL = function getURL(url) {
    var client = new XMLHttpRequest();
    client.open("GET",url,false);
    client.send();
    return client;
}

numeric.imageURL = function imageURL(img) {
    function base64(A) {
        var n = A.length, i,x,y,z,p,q,r,s;
        var key = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var ret = "";
        for(i=0;i<n;i+=3) {
            x = A[i];
            y = A[i+1];
            z = A[i+2];
            p = x >> 2;
            q = ((x & 3) << 4) + (y >> 4);
            r = ((y & 15) << 2) + (z >> 6);
            s = z & 63;
            if(i+1>=n) { r = s = 64; }
            else if(i+2>=n) { s = 64; }
            ret += key.charAt(p) + key.charAt(q) + key.charAt(r) + key.charAt(s);
            }
        return ret;
    }
    function crc32Array (a,from,to) {
        if(typeof from === "undefined") { from = 0; }
        if(typeof to === "undefined") { to = a.length; }
        var table = [0x00000000, 0x77073096, 0xEE0E612C, 0x990951BA, 0x076DC419, 0x706AF48F, 0xE963A535, 0x9E6495A3,
                     0x0EDB8832, 0x79DCB8A4, 0xE0D5E91E, 0x97D2D988, 0x09B64C2B, 0x7EB17CBD, 0xE7B82D07, 0x90BF1D91, 
                     0x1DB71064, 0x6AB020F2, 0xF3B97148, 0x84BE41DE, 0x1ADAD47D, 0x6DDDE4EB, 0xF4D4B551, 0x83D385C7,
                     0x136C9856, 0x646BA8C0, 0xFD62F97A, 0x8A65C9EC, 0x14015C4F, 0x63066CD9, 0xFA0F3D63, 0x8D080DF5, 
                     0x3B6E20C8, 0x4C69105E, 0xD56041E4, 0xA2677172, 0x3C03E4D1, 0x4B04D447, 0xD20D85FD, 0xA50AB56B, 
                     0x35B5A8FA, 0x42B2986C, 0xDBBBC9D6, 0xACBCF940, 0x32D86CE3, 0x45DF5C75, 0xDCD60DCF, 0xABD13D59, 
                     0x26D930AC, 0x51DE003A, 0xC8D75180, 0xBFD06116, 0x21B4F4B5, 0x56B3C423, 0xCFBA9599, 0xB8BDA50F,
                     0x2802B89E, 0x5F058808, 0xC60CD9B2, 0xB10BE924, 0x2F6F7C87, 0x58684C11, 0xC1611DAB, 0xB6662D3D,
                     0x76DC4190, 0x01DB7106, 0x98D220BC, 0xEFD5102A, 0x71B18589, 0x06B6B51F, 0x9FBFE4A5, 0xE8B8D433,
                     0x7807C9A2, 0x0F00F934, 0x9609A88E, 0xE10E9818, 0x7F6A0DBB, 0x086D3D2D, 0x91646C97, 0xE6635C01, 
                     0x6B6B51F4, 0x1C6C6162, 0x856530D8, 0xF262004E, 0x6C0695ED, 0x1B01A57B, 0x8208F4C1, 0xF50FC457, 
                     0x65B0D9C6, 0x12B7E950, 0x8BBEB8EA, 0xFCB9887C, 0x62DD1DDF, 0x15DA2D49, 0x8CD37CF3, 0xFBD44C65, 
                     0x4DB26158, 0x3AB551CE, 0xA3BC0074, 0xD4BB30E2, 0x4ADFA541, 0x3DD895D7, 0xA4D1C46D, 0xD3D6F4FB, 
                     0x4369E96A, 0x346ED9FC, 0xAD678846, 0xDA60B8D0, 0x44042D73, 0x33031DE5, 0xAA0A4C5F, 0xDD0D7CC9, 
                     0x5005713C, 0x270241AA, 0xBE0B1010, 0xC90C2086, 0x5768B525, 0x206F85B3, 0xB966D409, 0xCE61E49F, 
                     0x5EDEF90E, 0x29D9C998, 0xB0D09822, 0xC7D7A8B4, 0x59B33D17, 0x2EB40D81, 0xB7BD5C3B, 0xC0BA6CAD, 
                     0xEDB88320, 0x9ABFB3B6, 0x03B6E20C, 0x74B1D29A, 0xEAD54739, 0x9DD277AF, 0x04DB2615, 0x73DC1683, 
                     0xE3630B12, 0x94643B84, 0x0D6D6A3E, 0x7A6A5AA8, 0xE40ECF0B, 0x9309FF9D, 0x0A00AE27, 0x7D079EB1, 
                     0xF00F9344, 0x8708A3D2, 0x1E01F268, 0x6906C2FE, 0xF762575D, 0x806567CB, 0x196C3671, 0x6E6B06E7, 
                     0xFED41B76, 0x89D32BE0, 0x10DA7A5A, 0x67DD4ACC, 0xF9B9DF6F, 0x8EBEEFF9, 0x17B7BE43, 0x60B08ED5, 
                     0xD6D6A3E8, 0xA1D1937E, 0x38D8C2C4, 0x4FDFF252, 0xD1BB67F1, 0xA6BC5767, 0x3FB506DD, 0x48B2364B, 
                     0xD80D2BDA, 0xAF0A1B4C, 0x36034AF6, 0x41047A60, 0xDF60EFC3, 0xA867DF55, 0x316E8EEF, 0x4669BE79, 
                     0xCB61B38C, 0xBC66831A, 0x256FD2A0, 0x5268E236, 0xCC0C7795, 0xBB0B4703, 0x220216B9, 0x5505262F, 
                     0xC5BA3BBE, 0xB2BD0B28, 0x2BB45A92, 0x5CB36A04, 0xC2D7FFA7, 0xB5D0CF31, 0x2CD99E8B, 0x5BDEAE1D, 
                     0x9B64C2B0, 0xEC63F226, 0x756AA39C, 0x026D930A, 0x9C0906A9, 0xEB0E363F, 0x72076785, 0x05005713, 
                     0x95BF4A82, 0xE2B87A14, 0x7BB12BAE, 0x0CB61B38, 0x92D28E9B, 0xE5D5BE0D, 0x7CDCEFB7, 0x0BDBDF21, 
                     0x86D3D2D4, 0xF1D4E242, 0x68DDB3F8, 0x1FDA836E, 0x81BE16CD, 0xF6B9265B, 0x6FB077E1, 0x18B74777, 
                     0x88085AE6, 0xFF0F6A70, 0x66063BCA, 0x11010B5C, 0x8F659EFF, 0xF862AE69, 0x616BFFD3, 0x166CCF45, 
                     0xA00AE278, 0xD70DD2EE, 0x4E048354, 0x3903B3C2, 0xA7672661, 0xD06016F7, 0x4969474D, 0x3E6E77DB, 
                     0xAED16A4A, 0xD9D65ADC, 0x40DF0B66, 0x37D83BF0, 0xA9BCAE53, 0xDEBB9EC5, 0x47B2CF7F, 0x30B5FFE9, 
                     0xBDBDF21C, 0xCABAC28A, 0x53B39330, 0x24B4A3A6, 0xBAD03605, 0xCDD70693, 0x54DE5729, 0x23D967BF, 
                     0xB3667A2E, 0xC4614AB8, 0x5D681B02, 0x2A6F2B94, 0xB40BBE37, 0xC30C8EA1, 0x5A05DF1B, 0x2D02EF8D];
     
        var crc = -1, y = 0, n = a.length,i;

        for (i = from; i < to; i++) {
            y = (crc ^ a[i]) & 0xFF;
            crc = (crc >>> 8) ^ table[y];
        }
     
        return crc ^ (-1);
    }

    var h = img[0].length, w = img[0][0].length, s1, s2, next,k,length,a,b,i,j,adler32,crc32;
    var stream = [
                  137, 80, 78, 71, 13, 10, 26, 10,                           //  0: PNG signature
                  0,0,0,13,                                                  //  8: IHDR Chunk length
                  73, 72, 68, 82,                                            // 12: "IHDR" 
                  (w >> 24) & 255, (w >> 16) & 255, (w >> 8) & 255, w&255,   // 16: Width
                  (h >> 24) & 255, (h >> 16) & 255, (h >> 8) & 255, h&255,   // 20: Height
                  8,                                                         // 24: bit depth
                  2,                                                         // 25: RGB
                  0,                                                         // 26: deflate
                  0,                                                         // 27: no filter
                  0,                                                         // 28: no interlace
                  -1,-2,-3,-4,                                               // 29: CRC
                  -5,-6,-7,-8,                                               // 33: IDAT Chunk length
                  73, 68, 65, 84,                                            // 37: "IDAT"
                  // RFC 1950 header starts here
                  8,                                                         // 41: RFC1950 CMF
                  29                                                         // 42: RFC1950 FLG
                  ];
    crc32 = crc32Array(stream,12,29);
    stream[29] = (crc32>>24)&255;
    stream[30] = (crc32>>16)&255;
    stream[31] = (crc32>>8)&255;
    stream[32] = (crc32)&255;
    s1 = 1;
    s2 = 0;
    for(i=0;i<h;i++) {
        if(i<h-1) { stream.push(0); }
        else { stream.push(1); }
        a = (3*w+1+(i===0))&255; b = ((3*w+1+(i===0))>>8)&255;
        stream.push(a); stream.push(b);
        stream.push((~a)&255); stream.push((~b)&255);
        if(i===0) stream.push(0);
        for(j=0;j<w;j++) {
            for(k=0;k<3;k++) {
                a = img[k][i][j];
                if(a>255) a = 255;
                else if(a<0) a=0;
                else a = Math.round(a);
                s1 = (s1 + a )%65521;
                s2 = (s2 + s1)%65521;
                stream.push(a);
            }
        }
        stream.push(0);
    }
    adler32 = (s2<<16)+s1;
    stream.push((adler32>>24)&255);
    stream.push((adler32>>16)&255);
    stream.push((adler32>>8)&255);
    stream.push((adler32)&255);
    length = stream.length - 41;
    stream[33] = (length>>24)&255;
    stream[34] = (length>>16)&255;
    stream[35] = (length>>8)&255;
    stream[36] = (length)&255;
    crc32 = crc32Array(stream,37);
    stream.push((crc32>>24)&255);
    stream.push((crc32>>16)&255);
    stream.push((crc32>>8)&255);
    stream.push((crc32)&255);
    stream.push(0);
    stream.push(0);
    stream.push(0);
    stream.push(0);
//    a = stream.length;
    stream.push(73);  // I
    stream.push(69);  // E
    stream.push(78);  // N
    stream.push(68);  // D
    stream.push(174); // CRC1
    stream.push(66);  // CRC2
    stream.push(96);  // CRC3
    stream.push(130); // CRC4
    return 'data:image/png;base64,'+base64(stream);
}

// 2. Linear algebra with Arrays.
numeric._dim = function _dim(x) {
    var ret = [];
    while(typeof x === "object") { ret.push(x.length); x = x[0]; }
    return ret;
}

numeric.dim = function dim(x) {
    var y,z;
    if(typeof x === "object") {
        y = x[0];
        if(typeof y === "object") {
            z = y[0];
            if(typeof z === "object") {
                return numeric._dim(x);
            }
            return [x.length,y.length];
        }
        return [x.length];
    }
    return [];
}

numeric.mapreduce = function mapreduce(body,init) {
    return Function('x','accum','_s','_k',
            'if(typeof accum === "undefined") accum = '+init+';\n'+
            'if(typeof x === "number") { var xi = x; '+body+'; return accum; }\n'+
            'if(typeof _s === "undefined") _s = numeric.dim(x);\n'+
            'if(typeof _k === "undefined") _k = 0;\n'+
            'var _n = _s[_k];\n'+
            'var i,xi;\n'+
            'if(_k < _s.length-1) {\n'+
            '    for(i=_n-1;i>=0;i--) {\n'+
            '        accum = arguments.callee(x[i],accum,_s,_k+1);\n'+
            '    }'+
            '    return accum;\n'+
            '}\n'+
            'for(i=_n-1;i>=1;i-=2) { \n'+
            '    xi = x[i];\n'+
            '    '+body+';\n'+
            '    xi = x[i-1];\n'+
            '    '+body+';\n'+
            '}\n'+
            'if(i === 0) {\n'+
            '    xi = x[i];\n'+
            '    '+body+'\n'+
            '}\n'+
            'return accum;'
            );
}
numeric.mapreduce2 = function mapreduce2(body,setup) {
    return Function('x',
            'var n = x.length;\n'+
            'var i,xi;\n'+setup+';\n'+
            'for(i=n-1;i!==-1;--i) { \n'+
            '    xi = x[i];\n'+
            '    '+body+';\n'+
            '}\n'+
            'return accum;'
            );
}


numeric.same = function same(x,y) {
    var i,n;
    if(!(x instanceof Array) || !(y instanceof Array)) { return false; }
    n = x.length;
    if(n !== y.length) { return false; }
    for(i=0;i<n;i++) {
        if(x[i] === y[i]) { continue; }
        if(typeof x[i] === "object") { if(!same(x[i],y[i])) return false; }
        else { return false; }
    }
    return true;
}

numeric.rep = function rep(s,v,k) {
    if(typeof k === "undefined") { k=0; }
    var n = s[k], ret = Array(n), i;
    if(k === s.length-1) {
        for(i=n-2;i>=0;i-=2) { ret[i+1] = v; ret[i] = v; }
        if(i===-1) { ret[0] = v; }
        return ret;
    }
    for(i=n-1;i>=0;i--) { ret[i] = numeric.rep(s,v,k+1); }
    return ret;
}


numeric.dotMMsmall = function dotMMsmall(x,y) {
    var i,j,k,p,q,r,ret,foo,bar,woo,i0,k0,p0,r0;
    p = x.length; q = y.length; r = y[0].length;
    ret = Array(p);
    for(i=p-1;i>=0;i--) {
        foo = Array(r);
        bar = x[i];
        for(k=r-1;k>=0;k--) {
            woo = bar[q-1]*y[q-1][k];
            for(j=q-2;j>=1;j-=2) {
                i0 = j-1;
                woo += bar[j]*y[j][k] + bar[i0]*y[i0][k];
            }
            if(j===0) { woo += bar[0]*y[0][k]; }
            foo[k] = woo;
        }
        ret[i] = foo;
    }
    return ret;
}
numeric._getCol = function _getCol(A,j,x) {
    var n = A.length, i;
    for(i=n-1;i>0;--i) {
        x[i] = A[i][j];
        --i;
        x[i] = A[i][j];
    }
    if(i===0) x[0] = A[0][j];
}
numeric.dotMMbig = function dotMMbig(x,y){
    var gc = numeric._getCol, p = y.length, v = Array(p);
    var m = x.length, n = y[0].length, A = new Array(m), xj;
    var VV = numeric.dotVV;
    var i,j,k,z;
    --p;
    --m;
    for(i=m;i!==-1;--i) A[i] = Array(n);
    --n;
    for(i=n;i!==-1;--i) {
        gc(y,i,v);
        for(j=m;j!==-1;--j) {
            z=0;
            xj = x[j];
            A[j][i] = VV(xj,v);
        }
    }
    return A;
}

numeric.dotMV = function dotMV(x,y) {
    var p = x.length, q = y.length,i;
    var ret = Array(p), dotVV = numeric.dotVV;
    for(i=p-1;i>=0;i--) { ret[i] = dotVV(x[i],y); }
    return ret;
}

numeric.dotVM = function dotVM(x,y) {
    var i,j,k,p,q,r,ret,foo,bar,woo,i0,k0,p0,r0,s1,s2,s3,baz,accum;
    p = x.length; q = y[0].length;
    ret = Array(q);
    for(k=q-1;k>=0;k--) {
        woo = x[p-1]*y[p-1][k];
        for(j=p-2;j>=1;j-=2) {
            i0 = j-1;
            woo += x[j]*y[j][k] + x[i0]*y[i0][k];
        }
        if(j===0) { woo += x[0]*y[0][k]; }
        ret[k] = woo;
    }
    return ret;
}

numeric.dotVV = function dotVV(x,y) {
    var i,n=x.length,i1,ret = x[n-1]*y[n-1];
    for(i=n-2;i>=1;i-=2) {
        i1 = i-1;
        ret += x[i]*y[i] + x[i1]*y[i1];
    }
    if(i===0) { ret += x[0]*y[0]; }
    return ret;
}

numeric.dot = function dot(x,y) {
    var d = numeric.dim;
    switch(d(x).length*1000+d(y).length) {
    case 2002:
        if(y.length < 10) return numeric.dotMMsmall(x,y);
        else return numeric.dotMMbig(x,y);
    case 2001: return numeric.dotMV(x,y);
    case 1002: return numeric.dotVM(x,y);
    case 1001: return numeric.dotVV(x,y);
    case 1000: return numeric.mulVS(x,y);
    case 1: return numeric.mulSV(x,y);
    case 0: return x*y;
    default: throw new Error('numeric.dot only works on vectors and matrices');
    }
}

numeric.diag = function diag(d) {
    var i,i1,j,n = d.length, A = Array(n), Ai;
    for(i=n-1;i>=0;i--) {
        Ai = Array(n);
        i1 = i+2;
        for(j=n-1;j>=i1;j-=2) {
            Ai[j] = 0;
            Ai[j-1] = 0;
        }
        if(j>i) { Ai[j] = 0; }
        Ai[i] = d[i];
        for(j=i-1;j>=1;j-=2) {
            Ai[j] = 0;
            Ai[j-1] = 0;
        }
        if(j===0) { Ai[0] = 0; }
        A[i] = Ai;
    }
    return A;
}
numeric.getDiag = function(A) {
    var n = Math.min(A.length,A[0].length),i,ret = Array(n);
    for(i=n-1;i>=1;--i) {
        ret[i] = A[i][i];
        --i;
        ret[i] = A[i][i];
    }
    if(i===0) {
        ret[0] = A[0][0];
    }
    return ret;
}

numeric.identity = function identity(n) { return numeric.diag(numeric.rep([n],1)); }
numeric.pointwise = function pointwise(params,body,setup) {
    if(typeof setup === "undefined") { setup = ""; }
    var fun = [];
    var k;
    var avec = /\[i\]$/,p,thevec = '';
    var haveret = false;
    for(k=0;k<params.length;k++) {
        if(avec.test(params[k])) {
            p = params[k].substring(0,params[k].length-3);
            thevec = p;
        } else { p = params[k]; }
        if(p==='ret') haveret = true;
        fun.push(p);
    }
    fun[params.length] = '_s';
    fun[params.length+1] = '_k';
    fun[params.length+2] = (
            'if(typeof _s === "undefined") _s = numeric.dim('+thevec+');\n'+
            'if(typeof _k === "undefined") _k = 0;\n'+
            'var _n = _s[_k];\n'+
            'var i'+(haveret?'':', ret = Array(_n)')+';\n'+
            'if(_k < _s.length-1) {\n'+
            '    for(i=_n-1;i>=0;i--) ret[i] = arguments.callee('+params.join(',')+',_s,_k+1);\n'+
            '    return ret;\n'+
            '}\n'+
            setup+'\n'+
            'for(i=_n-1;i!==-1;--i) {\n'+
            '    '+body+'\n'+
            '}\n'+
            'return ret;'
            );
    return Function.apply(null,fun);
}
numeric.pointwise2 = function pointwise2(params,body,setup) {
    if(typeof setup === "undefined") { setup = ""; }
    var fun = [];
    var k;
    var avec = /\[i\]$/,p,thevec = '';
    var haveret = false;
    for(k=0;k<params.length;k++) {
        if(avec.test(params[k])) {
            p = params[k].substring(0,params[k].length-3);
            thevec = p;
        } else { p = params[k]; }
        if(p==='ret') haveret = true;
        fun.push(p);
    }
    fun[params.length] = (
            'var _n = '+thevec+'.length;\n'+
            'var i'+(haveret?'':', ret = Array(_n)')+';\n'+
            setup+'\n'+
            'for(i=_n-1;i!==-1;--i) {\n'+
            body+'\n'+
            '}\n'+
            'return ret;'
            );
    return Function.apply(null,fun);
}
numeric._biforeach = (function _biforeach(x,y,s,k,f) {
    if(k === s.length-1) { f(x,y); return; }
    var i,n=s[k];
    for(i=n-1;i>=0;i--) { _biforeach(typeof x==="object"?x[i]:x,typeof y==="object"?y[i]:y,s,k+1,f); }
});
numeric._biforeach2 = (function _biforeach2(x,y,s,k,f) {
    if(k === s.length-1) { return f(x,y); }
    var i,n=s[k],ret = Array(n);
    for(i=n-1;i>=0;--i) { ret[i] = _biforeach2(typeof x==="object"?x[i]:x,typeof y==="object"?y[i]:y,s,k+1,f); }
    return ret;
});
numeric._foreach = (function _foreach(x,s,k,f) {
    if(k === s.length-1) { f(x); return; }
    var i,n=s[k];
    for(i=n-1;i>=0;i--) { _foreach(x[i],s,k+1,f); }
});
numeric._foreach2 = (function _foreach2(x,s,k,f) {
    if(k === s.length-1) { return f(x); }
    var i,n=s[k], ret = Array(n);
    for(i=n-1;i>=0;i--) { ret[i] = _foreach2(x[i],s,k+1,f); }
    return ret;
});

/*numeric.anyV = numeric.mapreduce('if(xi) return true;','false');
numeric.allV = numeric.mapreduce('if(!xi) return false;','true');
numeric.any = function(x) { if(typeof x.length === "undefined") return x; return numeric.anyV(x); }
numeric.all = function(x) { if(typeof x.length === "undefined") return x; return numeric.allV(x); }*/

numeric.ops2 = {
        add: '+',
        sub: '-',
        mul: '*',
        div: '/',
        mod: '%',
        and: '&&',
        or:  '||',
        eq:  '===',
        neq: '!==',
        lt:  '<',
        gt:  '>',
        leq: '<=',
        geq: '>=',
        band: '&',
        bor: '|',
        bxor: '^',
        lshift: '<<',
        rshift: '>>',
        rrshift: '>>>'
};
numeric.opseq = {
        addeq: '+=',
        subeq: '-=',
        muleq: '*=',
        diveq: '/=',
        modeq: '%=',
        lshifteq: '<<=',
        rshifteq: '>>=',
        rrshifteq: '>>>=',
        bandeq: '&=',
        boreq: '|=',
        bxoreq: '^='
};
numeric.mathfuns = ['abs','acos','asin','atan','ceil','cos',
                    'exp','floor','log','round','sin','sqrt','tan',
                    'isNaN','isFinite'];
numeric.mathfuns2 = ['atan2','pow','max','min'];
numeric.ops1 = {
        neg: '-',
        not: '!',
        bnot: '~',
        clone: ''
};
numeric.mapreducers = {
        any: ['if(xi) return true;','var accum = false;'],
        all: ['if(!xi) return false;','var accum = true;'],
        sum: ['accum += xi;','var accum = 0;'],
        prod: ['accum *= xi;','var accum = 1;'],
        norm2Squared: ['accum += xi*xi;','var accum = 0;'],
        norminf: ['accum = max(accum,abs(xi));','var accum = 0, max = Math.max, abs = Math.abs;'],
        norm1: ['accum += abs(xi)','var accum = 0, abs = Math.abs;'],
        sup: ['accum = max(accum,xi);','var accum = -Infinity, max = Math.max;'],
        inf: ['accum = min(accum,xi);','var accum = Infinity, min = Math.min;']
};

(function () {
    var i,o;
    for(i=0;i<numeric.mathfuns2.length;++i) {
        o = numeric.mathfuns2[i];
        numeric.ops2[o] = o;
    }
    for(i in numeric.ops2) {
        if(numeric.ops2.hasOwnProperty(i)) {
            o = numeric.ops2[i];
            var code, codeeq, setup = '';
            if(numeric.myIndexOf.call(numeric.mathfuns2,i)!==-1) {
                setup = 'var '+o+' = Math.'+o+';\n';
                code = function(r,x,y) { return r+' = '+o+'('+x+','+y+')'; };
                codeeq = function(x,y) { return x+' = '+o+'('+x+','+y+')'; };
            } else {
                code = function(r,x,y) { return r+' = '+x+' '+o+' '+y; };
                if(numeric.opseq.hasOwnProperty(i+'eq')) {
                    codeeq = function(x,y) { return x+' '+o+'= '+y; };
                } else {
                    codeeq = function(x,y) { return x+' = '+x+' '+o+' '+y; };                    
                }
            }
            numeric[i+'VV'] = numeric.pointwise2(['x[i]','y[i]'],code('ret[i]','x[i]','y[i]'),setup);
            numeric[i+'SV'] = numeric.pointwise2(['x','y[i]'],code('ret[i]','x','y[i]'),setup);
            numeric[i+'VS'] = numeric.pointwise2(['x[i]','y'],code('ret[i]','x[i]','y'),setup);
            numeric[i] = Function(
                    'var n = arguments.length, i, x = arguments[0], y;\n'+
                    'var VV = numeric.'+i+'VV, VS = numeric.'+i+'VS, SV = numeric.'+i+'SV;\n'+
                    'var dim = numeric.dim;\n'+
                    'for(i=1;i!==n;++i) { \n'+
                    '  y = arguments[i];\n'+
                    '  if(typeof x === "object") {\n'+
                    '      if(typeof y === "object") x = numeric._biforeach2(x,y,dim(x),0,VV);\n'+
                    '      else x = numeric._biforeach2(x,y,dim(x),0,VS);\n'+
                    '  } else if(typeof y === "object") x = numeric._biforeach2(x,y,dim(y),0,SV);\n'+
                    '  else '+codeeq('x','y')+'\n'+
                    '}\nreturn x;\n');
            numeric[o] = numeric[i];
            numeric[i+'eqV'] = numeric.pointwise2(['ret[i]','x[i]'], codeeq('ret[i]','x[i]'),setup);
            numeric[i+'eqS'] = numeric.pointwise2(['ret[i]','x'], codeeq('ret[i]','x'),setup);
            numeric[i+'eq'] = Function(
                    'var n = arguments.length, i, x = arguments[0], y;\n'+
                    'var V = numeric.'+i+'eqV, S = numeric.'+i+'eqS\n'+
                    'var s = numeric.dim(x);\n'+
                    'for(i=1;i!==n;++i) { \n'+
                    '  y = arguments[i];\n'+
                    '  if(typeof y === "object") numeric._biforeach(x,y,s,0,V);\n'+
                    '  else numeric._biforeach(x,y,s,0,S);\n'+
                    '}\nreturn x;\n');
        }
    }
    for(i=0;i<numeric.mathfuns2.length;++i) {
        o = numeric.mathfuns2[i];
        delete numeric.ops2[o];
    }
    for(i=0;i<numeric.mathfuns.length;++i) {
        o = numeric.mathfuns[i];
        numeric.ops1[o] = o;
    }
    for(i in numeric.ops1) {
        if(numeric.ops1.hasOwnProperty(i)) {
            setup = '';
            o = numeric.ops1[i];
            if(numeric.myIndexOf.call(numeric.mathfuns,i)!==-1) {
                if(Math.hasOwnProperty(o)) setup = 'var '+o+' = Math.'+o+';\n';
            }
            numeric[i+'eqV'] = numeric.pointwise2(['ret[i]'],'ret[i] = '+o+'(ret[i]);',setup);
            numeric[i+'eq'] = Function('x',
                    'if(typeof x !== "object") return '+o+'x\n'+
                    'var i;\n'+
                    'var V = numeric.'+i+'eqV;\n'+
                    'var s = numeric.dim(x);\n'+
                    'numeric._foreach(x,s,0,V);\n'+
                    'return x;\n');
            numeric[i+'V'] = numeric.pointwise2(['x[i]'],'ret[i] = '+o+'(x[i]);',setup);
            numeric[i] = Function('x',
                    'if(typeof x !== "object") return '+o+'(x)\n'+
                    'var i;\n'+
                    'var V = numeric.'+i+'V;\n'+
                    'var s = numeric.dim(x);\n'+
                    'return numeric._foreach2(x,s,0,V);\n');
        }
    }
    for(i=0;i<numeric.mathfuns.length;++i) {
        o = numeric.mathfuns[i];
        delete numeric.ops1[o];
    }
    for(i in numeric.mapreducers) {
        if(numeric.mapreducers.hasOwnProperty(i)) {
            o = numeric.mapreducers[i];
            numeric[i+'V'] = numeric.mapreduce2(o[0],o[1]);
            numeric[i] = Function('x','s','k',
                    o[1]+
                    'if(typeof x !== "object") {'+
                    '    xi = x;\n'+
                    o[0]+';\n'+
                    '    return accum;\n'+
                    '}'+
                    'if(typeof s === "undefined") s = numeric.dim(x);\n'+
                    'if(typeof k === "undefined") k = 0;\n'+
                    'if(k === s.length-1) return numeric.'+i+'V(x);\n'+
                    'var xi;\n'+
                    'var n = x.length, i;\n'+
                    'for(i=n-1;i!==-1;--i) {\n'+
                    '   xi = arguments.callee(x[i]);\n'+
                    o[0]+';\n'+
                    '}\n'+
                    'return accum;\n');
        }
    }
}());

numeric.truncVV = numeric.pointwise(['x[i]','y[i]'],'ret[i] = round(x[i]/y[i])*y[i];','var round = Math.round;');
numeric.truncVS = numeric.pointwise(['x[i]','y'],'ret[i] = round(x[i]/y)*y;','var round = Math.round;');
numeric.truncSV = numeric.pointwise(['x','y[i]'],'ret[i] = round(x/y[i])*y[i];','var round = Math.round;');
numeric.trunc = function trunc(x,y) {
    if(typeof x === "object") {
        if(typeof y === "object") return numeric.truncVV(x,y);
        return numeric.truncVS(x,y);
    }
    if (typeof y === "object") return numeric.truncSV(x,y);
    return Math.round(x/y)*y;
}

numeric.inv = function inv(x) {
    var s = numeric.dim(x), abs = Math.abs, m = s[0], n = s[1];
    var A = numeric.clone(x), Ai, Aj;
    var I = numeric.identity(m), Ii, Ij;
    var i,j,k,x;
    for(j=0;j<n;++j) {
        var i0 = -1;
        var v0 = -1;
        for(i=j;i!==m;++i) { k = abs(A[i][j]); if(k>v0) { i0 = i; v0 = k; } }
        Aj = A[i0]; A[i0] = A[j]; A[j] = Aj;
        Ij = I[i0]; I[i0] = I[j]; I[j] = Ij;
        x = Aj[j];
        for(k=j;k!==n;++k)    Aj[k] /= x; 
        for(k=n-1;k!==-1;--k) Ij[k] /= x;
        for(i=m-1;i!==-1;--i) {
            if(i!==j) {
                Ai = A[i];
                Ii = I[i];
                x = Ai[j];
                for(k=j+1;k!==n;++k)  Ai[k] -= Aj[k]*x;
                for(k=n-1;k>0;--k) { Ii[k] -= Ij[k]*x; --k; Ii[k] -= Ij[k]*x; }
                if(k===0) Ii[0] -= Ij[0]*x;
            }
        }
    }
    return I;
}

numeric.det = function det(x) {
    var s = numeric.dim(x);
    if(s.length !== 2 || s[0] !== s[1]) { throw new Error('numeric: det() only works on square matrices'); }
    var n = s[0], ret = 1,i,j,k,A = numeric.clone(x),Aj,Ai,alpha,temp,k1,k2,k3;
    for(j=0;j<n-1;j++) {
        k=j;
        for(i=j+1;i<n;i++) { if(Math.abs(A[i][j]) > Math.abs(A[k][j])) { k = i; } }
        if(k !== j) {
            temp = A[k]; A[k] = A[j]; A[j] = temp;
            ret *= -1;
        }
        Aj = A[j];
        for(i=j+1;i<n;i++) {
            Ai = A[i];
            alpha = Ai[j]/Aj[j];
            for(k=j+1;k<n-1;k+=2) {
                k1 = k+1;
                Ai[k] -= Aj[k]*alpha;
                Ai[k1] -= Aj[k1]*alpha;
            }
            if(k!==n) { Ai[k] -= Aj[k]*alpha; }
        }
        if(Aj[j] === 0) { return 0; }
        ret *= Aj[j];
    }
    return ret*A[j][j];
}

numeric.transpose = function transpose(x) {
    var i,j,m = x.length,n = x[0].length, ret=Array(n),A0,A1,Bj;
    for(j=0;j<n;j++) ret[j] = Array(m);
    for(i=m-1;i>=1;i-=2) {
        A1 = x[i];
        A0 = x[i-1];
        for(j=n-1;j>=1;--j) {
            Bj = ret[j]; Bj[i] = A1[j]; Bj[i-1] = A0[j];
            --j;
            Bj = ret[j]; Bj[i] = A1[j]; Bj[i-1] = A0[j];
        }
        if(j===0) {
            Bj = ret[0]; Bj[i] = A1[0]; Bj[i-1] = A0[0];
        }
    }
    if(i===0) {
        A0 = x[0];
        for(j=n-1;j>=1;--j) {
            ret[j][0] = A0[j];
            --j;
            ret[j][0] = A0[j];
        }
        if(j===0) { ret[0][0] = A0[0]; }
    }
    return ret;
}
numeric.negtranspose = function negtranspose(x) {
    var i,j,m = x.length,n = x[0].length, ret=Array(n),A0,A1,Bj;
    for(j=0;j<n;j++) ret[j] = Array(m);
    for(i=m-1;i>=1;i-=2) {
        A1 = x[i];
        A0 = x[i-1];
        for(j=n-1;j>=1;--j) {
            Bj = ret[j]; Bj[i] = -A1[j]; Bj[i-1] = -A0[j];
            --j;
            Bj = ret[j]; Bj[i] = -A1[j]; Bj[i-1] = -A0[j];
        }
        if(j===0) {
            Bj = ret[0]; Bj[i] = -A1[0]; Bj[i-1] = -A0[0];
        }
    }
    if(i===0) {
        A0 = x[0];
        for(j=n-1;j>=1;--j) {
            ret[j][0] = -A0[j];
            --j;
            ret[j][0] = -A0[j];
        }
        if(j===0) { ret[0][0] = -A0[0]; }
    }
    return ret;
}

numeric._random = function _random(s,k) {
    var i,n=s[k],ret=Array(n), rnd;
    if(k === s.length-1) {
        rnd = Math.random;
        for(i=n-1;i>=1;i-=2) {
            ret[i] = rnd();
            ret[i-1] = rnd();
        }
        if(i===0) { ret[0] = rnd(); }
        return ret;
    }
    for(i=n-1;i>=0;i--) ret[i] = _random(s,k+1);
    return ret;
}
numeric.random = function random(s) { return numeric._random(s,0); }

numeric.norm2 = function norm2(x) { return Math.sqrt(numeric.norm2Squared(x)); }

numeric.linspace = function linspace(a,b,n) {
    if(typeof n === "undefined") n = Math.max(Math.round(b-a)+1,1);
    if(n<2) { return n===1?[a]:[]; }
    var i,ret = Array(n);
    n--;
    for(i=n;i>=0;i--) { ret[i] = (i*b+(n-i)*a)/n; }
    return ret;
}

numeric.getBlock = function getBlock(x,from,to) {
    var s = numeric.dim(x);
    function foo(x,k) {
        var i,a = from[k], n = to[k]-a, ret = Array(n);
        if(k === s.length-1) {
            for(i=n;i>=0;i--) { ret[i] = x[i+a]; }
            return ret;
        }
        for(i=n;i>=0;i--) { ret[i] = foo(x[i+a],k+1); }
        return ret;
    }
    return foo(x,0);
}

numeric.setBlock = function setBlock(x,from,to,B) {
    var s = numeric.dim(x);
    function foo(x,y,k) {
        var i,a = from[k], n = to[k]-a;
        if(k === s.length-1) { for(i=n;i>=0;i--) { x[i+a] = y[i]; } }
        for(i=n;i>=0;i--) { foo(x[i+a],y[i],k+1); }
    }
    foo(x,B,0);
    return x;
}

numeric.getRange = function getRange(A,I,J) {
    var m = I.length, n = J.length;
    var i,j;
    var B = Array(m), Bi, AI;
    for(i=m-1;i!==-1;--i) {
        B[i] = Array(n);
        Bi = B[i];
        AI = A[I[i]];
        for(j=n-1;j!==-1;--j) Bi[j] = AI[J[j]];
    }
    return B;
}

numeric.blockMatrix = function blockMatrix(X) {
    var s = numeric.dim(X);
    if(s.length<4) return numeric.blockMatrix([X]);
    var m=s[0],n=s[1],M,N,i,j,Xij;
    M = 0; N = 0;
    for(i=0;i<m;++i) M+=X[i][0].length;
    for(j=0;j<n;++j) N+=X[0][j][0].length;
    var Z = Array(M);
    for(i=0;i<M;++i) Z[i] = Array(N);
    var I=0,J,ZI,k,l,Xijk;
    for(i=0;i<m;++i) {
        J=N;
        for(j=n-1;j!==-1;--j) {
            Xij = X[i][j];
            J -= Xij[0].length;
            for(k=Xij.length-1;k!==-1;--k) {
                Xijk = Xij[k];
                ZI = Z[I+k];
                for(l = Xijk.length-1;l!==-1;--l) ZI[J+l] = Xijk[l];
            }
        }
        I += X[i][0].length;
    }
    return Z;
}

numeric.tensor = function tensor(x,y) {
    if(typeof x === "number" || typeof y === "number") return numeric.mul(x,y);
    var s1 = numeric.dim(x), s2 = numeric.dim(y);
    if(s1.length !== 1 || s2.length !== 1) {
        throw new Error('numeric: tensor product is only defined for vectors');
    }
    var m = s1[0], n = s2[0], A = Array(m), Ai, i,j,xi;
    for(i=m-1;i>=0;i--) {
        Ai = Array(n);
        xi = x[i];
        for(j=n-1;j>=3;--j) {
            Ai[j] = xi * y[j];
            --j;
            Ai[j] = xi * y[j];
            --j;
            Ai[j] = xi * y[j];
            --j;
            Ai[j] = xi * y[j];
        }
        while(j>=0) { Ai[j] = xi * y[j]; --j; }
        A[i] = Ai;
    }
    return A;
}

// 3. The Tensor type T
numeric.T = function T(x,y) { this.x = x; this.y = y; }
numeric.t = function t(x,y) { return new numeric.T(x,y); }

numeric.Tbinop = function Tbinop(rr,rc,cr,cc,setup) {
    var io = numeric.indexOf;
    if(typeof setup !== "string") {
        var k;
        setup = '';
        for(k in numeric) {
            if(numeric.hasOwnProperty(k) && (rr.indexOf(k)>=0 || rc.indexOf(k)>=0 || cr.indexOf(k)>=0 || cc.indexOf(k)>=0) && k.length>1) {
                setup += 'var '+k+' = numeric.'+k+';\n';
            }
        }
    }
    return Function(['y'],
            'var x = this;\n'+
            'if(!(y instanceof numeric.T)) { y = new numeric.T(y); }\n'+
            setup+'\n'+
            'if(x.y) {'+
            '  if(y.y) {'+
            '    return new numeric.T('+cc+');\n'+
            '  }\n'+
            '  return new numeric.T('+cr+');\n'+
            '}\n'+
            'if(y.y) {\n'+
            '  return new numeric.T('+rc+');\n'+
            '}\n'+
            'return new numeric.T('+rr+');\n'
    );
}

numeric.T.prototype.add = numeric.Tbinop(
        'add(x.x,y.x)',
        'add(x.x,y.x),y.y',
        'add(x.x,y.x),x.y',
        'add(x.x,y.x),add(x.y,y.y)');
numeric.T.prototype.sub = numeric.Tbinop(
        'sub(x.x,y.x)',
        'sub(x.x,y.x),neg(y.y)',
        'sub(x.x,y.x),x.y',
        'sub(x.x,y.x),sub(x.y,y.y)');
numeric.T.prototype.mul = numeric.Tbinop(
        'mul(x.x,y.x)',
        'mul(x.x,y.x),mul(x.x,y.y)',
        'mul(x.x,y.x),mul(x.y,y.x)',
        'sub(mul(x.x,y.x),mul(x.y,y.y)),add(mul(x.x,y.y),mul(x.y,y.x))');

numeric.T.prototype.reciprocal = function reciprocal() {
    var mul = numeric.mul, div = numeric.div;
    if(this.y) {
        var d = numeric.add(mul(this.x,this.x),mul(this.y,this.y));
        return new numeric.T(div(this.x,d),div(numeric.neg(this.y),d));
    }
    return new T(div(1,this.x));
}
numeric.T.prototype.div = function div(y) {
    if(!(y instanceof numeric.T)) y = new numeric.T(y);
    if(y.y) { return this.mul(y.reciprocal()); }
    var div = numeric.div;
    if(this.y) { return new numeric.T(div(this.x,y.x),div(this.y,y.x)); }
    return new numeric.T(div(this.x,y.x));
}
numeric.T.prototype.dot = numeric.Tbinop(
        'dot(x.x,y.x)',
        'dot(x.x,y.x),dot(x.x,y.y)',
        'dot(x.x,y.x),dot(x.y,y.x)',
        'sub(dot(x.x,y.x),dot(x.y,y.y)),add(dot(x.x,y.y),dot(x.y,y.x))'
        );
numeric.T.prototype.transpose = function transpose() {
    var t = numeric.transpose, x = this.x, y = this.y;
    if(y) { return new numeric.T(t(x),t(y)); }
    return new numeric.T(t(x));
}
numeric.T.prototype.transjugate = function transjugate() {
    var t = numeric.transpose, x = this.x, y = this.y;
    if(y) { return new numeric.T(t(x),numeric.negtranspose(y)); }
    return new numeric.T(t(x));
}
numeric.Tunop = function Tunop(r,c,s) {
    if(typeof s !== "string") { s = ''; }
    return Function(
            'var x = this;\n'+
            s+'\n'+
            'if(x.y) {'+
            '  '+c+';\n'+
            '}\n'+
            r+';\n'
    );
}

numeric.T.prototype.exp = numeric.Tunop(
        'return new numeric.T(ex)',
        'return new numeric.T(mul(cos(x.y),ex),mul(sin(x.y),ex))',
        'var ex = numeric.exp(x.x), cos = numeric.cos, sin = numeric.sin, mul = numeric.mul;');
numeric.T.prototype.conj = numeric.Tunop(
        'return new numeric.T(x.x);',
        'return new numeric.T(x.x,numeric.neg(x.y));');
numeric.T.prototype.neg = numeric.Tunop(
        'return new numeric.T(neg(x.x));',
        'return new numeric.T(neg(x.x),neg(x.y));',
        'var neg = numeric.neg;');
numeric.T.prototype.sin = numeric.Tunop(
        'return new numeric.T(numeric.sin(x.x))',
        'return x.exp().sub(x.neg().exp()).div(new numeric.T(0,2));');
numeric.T.prototype.cos = numeric.Tunop(
        'return new numeric.T(numeric.cos(x.x))',
        'return x.exp().add(x.neg().exp()).div(2);');
numeric.T.prototype.abs = numeric.Tunop(
        'return new numeric.T(numeric.abs(x.x));',
        'return new numeric.T(numeric.sqrt(numeric.add(mul(x.x,x.x),mul(x.y,x.y))));',
        'var mul = numeric.mul;');
numeric.T.prototype.log = numeric.Tunop(
        'return new numeric.T(numeric.log(x.x));',
        'var theta = new numeric.T(numeric.atan2(x.y,x.x)), r = x.abs();\n'+
        'return new numeric.T(numeric.log(r.x),theta.x);');
numeric.T.prototype.norm2 = numeric.Tunop(
        'return numeric.norm2(x.x);',
        'var f = numeric.norm2Squared;\n'+
        'return Math.sqrt(f(x.x)+f(x.y));');
numeric.T.prototype.inv = function inv() {
    var A = this;
    if(typeof A.y === "undefined") { return new numeric.T(numeric.inv(A.x)); }
    var n = A.x.length, i, j, k;
    var Rx = numeric.identity(n),Ry = numeric.rep([n,n],0);
    var Ax = numeric.clone(A.x), Ay = numeric.clone(A.y);
    var Aix, Aiy, Ajx, Ajy, Rix, Riy, Rjx, Rjy;
    var i,j,k,d,d1,ax,ay,bx,by,temp;
    for(i=0;i<n;i++) {
        ax = Ax[i][i]; ay = Ay[i][i];
        d = ax*ax+ay*ay;
        k = i;
        for(j=i+1;j<n;j++) {
            ax = Ax[j][i]; ay = Ay[j][i];
            d1 = ax*ax+ay*ay;
            if(d1 > d) { k=j; d = d1; }
        }
        if(k!==i) {
            temp = Ax[i]; Ax[i] = Ax[k]; Ax[k] = temp;
            temp = Ay[i]; Ay[i] = Ay[k]; Ay[k] = temp;
            temp = Rx[i]; Rx[i] = Rx[k]; Rx[k] = temp;
            temp = Ry[i]; Ry[i] = Ry[k]; Ry[k] = temp;
        }
        Aix = Ax[i]; Aiy = Ay[i];
        Rix = Rx[i]; Riy = Ry[i];
        ax = Aix[i]; ay = Aiy[i];
        for(j=i+1;j<n;j++) {
            bx = Aix[j]; by = Aiy[j];
            Aix[j] = (bx*ax+by*ay)/d;
            Aiy[j] = (by*ax-bx*ay)/d;
        }
        for(j=0;j<n;j++) {
            bx = Rix[j]; by = Riy[j];
            Rix[j] = (bx*ax+by*ay)/d;
            Riy[j] = (by*ax-bx*ay)/d;
        }
        for(j=i+1;j<n;j++) {
            Ajx = Ax[j]; Ajy = Ay[j];
            Rjx = Rx[j]; Rjy = Ry[j];
            ax = Ajx[i]; ay = Ajy[i];
            for(k=i+1;k<n;k++) {
                bx = Aix[k]; by = Aiy[k];
                Ajx[k] -= bx*ax-by*ay;
                Ajy[k] -= by*ax+bx*ay;
            }
            for(k=0;k<n;k++) {
                bx = Rix[k]; by = Riy[k];
                Rjx[k] -= bx*ax-by*ay;
                Rjy[k] -= by*ax+bx*ay;
            }
        }
    }
    for(i=n-1;i>0;i--) {
        Rix = Rx[i]; Riy = Ry[i];
        for(j=i-1;j>=0;j--) {
            Rjx = Rx[j]; Rjy = Ry[j];
            ax = Ax[j][i]; ay = Ay[j][i];
            for(k=n-1;k>=0;k--) {
                bx = Rix[k]; by = Riy[k];
                Rjx[k] -= ax*bx - ay*by;
                Rjy[k] -= ax*by + ay*bx;
            }
        }
    }
    return new numeric.T(Rx,Ry);
}
numeric.T.prototype.get = function get(i) {
    var x = this.x, y = this.y, k = 0, ik, n = i.length;
    if(y) {
        while(k<n) {
            ik = i[k];
            x = x[ik];
            y = y[ik];
            k++;
        }
        return new numeric.T(x,y);
    }
    while(k<n) {
        ik = i[k];
        x = x[ik];
        k++;
    }
    return new numeric.T(x);
}
numeric.T.prototype.set = function set(i,v) {
    var x = this.x, y = this.y, k = 0, ik, n = i.length, vx = v.x, vy = v.y;
    if(n===0) {
        if(vy) { this.y = vy; }
        else if(y) { this.y = undefined; }
        this.x = x;
        return this;
    }
    if(vy) {
        if(y) { /* ok */ }
        else {
            y = numeric.rep(numeric.dim(x),0);
            this.y = y;
        }
        while(k<n-1) {
            ik = i[k];
            x = x[ik];
            y = y[ik];
            k++;
        }
        ik = i[k];
        x[ik] = vx;
        y[ik] = vy;
        return this;
    }
    if(y) {
        while(k<n-1) {
            ik = i[k];
            x = x[ik];
            y = y[ik];
            k++;
        }
        ik = i[k];
        x[ik] = vx;
        if(vx instanceof Array) y[ik] = numeric.rep(numeric.dim(vx),0);
        else y[ik] = 0;
        return this;
    }
    while(k<n-1) {
        ik = i[k];
        x = x[ik];
        k++;
    }
    ik = i[k];
    x[ik] = vx;
    return this;
}
numeric.T.prototype.getRows = function getRows(i0,i1) {
    var n = i1-i0+1, j;
    var rx = Array(n), ry, x = this.x, y = this.y;
    for(j=i0;j<=i1;j++) { rx[j-i0] = x[j]; }
    if(y) {
        ry = Array(n);
        for(j=i0;j<=i1;j++) { ry[j-i0] = y[j]; }
        return new numeric.T(rx,ry);
    }
    return new numeric.T(rx);
}
numeric.T.prototype.setRows = function setRows(i0,i1,A) {
    var j;
    var rx = this.x, ry = this.y, x = A.x, y = A.y;
    for(j=i0;j<=i1;j++) { rx[j] = x[j-i0]; }
    if(y) {
        if(!ry) { ry = numeric.rep(numeric.dim(rx),0); this.y = ry; }
        for(j=i0;j<=i1;j++) { ry[j] = y[j-i0]; }
    } else if(ry) {
        for(j=i0;j<=i1;j++) { ry[j] = numeric.rep([x[j-i0].length],0); }
    }
    return this;
}
numeric.T.prototype.getRow = function getRow(k) {
    var x = this.x, y = this.y;
    if(y) { return new numeric.T(x[k],y[k]); }
    return new numeric.T(x[k]);
}
numeric.T.prototype.setRow = function setRow(i,v) {
    var rx = this.x, ry = this.y, x = v.x, y = v.y;
    rx[i] = x;
    if(y) {
        if(!ry) { ry = numeric.rep(numeric.dim(rx),0); this.y = ry; }
        ry[i] = y;
    } else if(ry) {
        ry = numeric.rep([x.length],0);
    }
    return this;
}

numeric.T.prototype.getBlock = function getBlock(from,to) {
    var x = this.x, y = this.y, b = numeric.getBlock;
    if(y) { return new numeric.T(b(x,from,to),b(y,from,to)); }
    return new numeric.T(b(x,from,to));
}
numeric.T.prototype.setBlock = function setBlock(from,to,A) {
    if(!(A instanceof numeric.T)) A = new numeric.T(A);
    var x = this.x, y = this.y, b = numeric.setBlock, Ax = A.x, Ay = A.y;
    if(Ay) {
        if(!y) { this.y = numeric.rep(numeric.dim(this),0); y = this.y; }
        b(x,from,to,Ax);
        b(y,from,to,Ay);
        return this;
    }
    b(x,from,to,Ax);
    if(y) b(y,from,to,numeric.rep(numeric.dim(Ax),0));
}
numeric.T.rep = function rep(s,v) {
    var T = numeric.T;
    if(!(v instanceof T)) v = new T(v);
    var x = v.x, y = v.y, r = numeric.rep;
    if(y) return new T(r(s,x),r(s,y));
    return new T(r(s,x));
}
numeric.T.diag = function diag(d) {
    if(!(d instanceof numeric.T)) d = new numeric.T(d);
    var x = d.x, y = d.y, diag = numeric.diag;
    if(y) return new numeric.T(diag(x),diag(y));
    return new numeric.T(diag(x));
}
numeric.T.eig = function eig() {
    if(this.y) { throw new Error('eig: not implemented for complex matrices.'); }
    return numeric.eig(this.x);
}
numeric.T.identity = function identity(n) { return new numeric.T(numeric.identity(n)); }
numeric.T.prototype.getDiag = function getDiag() {
    var n = numeric;
    var x = this.x, y = this.y;
    if(y) { return new n.T(n.getDiag(x),n.getDiag(y)); }
    return new n.T(n.getDiag(x));
}

// 4. Eigenvalues of real matrices

numeric.house = function house(x) {
    var v = numeric.clone(x);
    var s = x[0] >= 0 ? 1 : -1;
    var alpha = s*numeric.norm2(x);
    v[0] += alpha;
    var foo = numeric.norm2(v);
    if(foo === 0) { /* this should not happen */ throw new Error('eig: internal error'); }
    return numeric.div(v,foo);
}

numeric.toUpperHessenberg = function toUpperHessenberg(me) {
    var s = numeric.dim(me);
    if(s.length !== 2 || s[0] !== s[1]) { throw new Error('numeric: toUpperHessenberg() only works on square matrices'); }
    var m = s[0], i,j,k,x,v,A = numeric.clone(me),B,C,Ai,Ci,Q = numeric.identity(m),Qi;
    for(j=0;j<m-2;j++) {
        x = Array(m-j-1);
        for(i=j+1;i<m;i++) { x[i-j-1] = A[i][j]; }
        if(numeric.norm2(x)>0) {
            v = numeric.house(x);
            B = numeric.getBlock(A,[j+1,j],[m-1,m-1]);
            C = numeric.tensor(v,numeric.dot(v,B));
            for(i=j+1;i<m;i++) { Ai = A[i]; Ci = C[i-j-1]; for(k=j;k<m;k++) Ai[k] -= 2*Ci[k-j]; }
            B = numeric.getBlock(A,[0,j+1],[m-1,m-1]);
            C = numeric.tensor(numeric.dot(B,v),v);
            for(i=0;i<m;i++) { Ai = A[i]; Ci = C[i]; for(k=j+1;k<m;k++) Ai[k] -= 2*Ci[k-j-1]; }
            B = Array(m-j-1);
            for(i=j+1;i<m;i++) B[i-j-1] = Q[i];
            C = numeric.tensor(v,numeric.dot(v,B));
            for(i=j+1;i<m;i++) { Qi = Q[i]; Ci = C[i-j-1]; for(k=0;k<m;k++) Qi[k] -= 2*Ci[k]; }
        }
    }
    return {H:A, Q:Q};
}

numeric.epsilon = 2.220446049250313e-16;

numeric.QRFrancis = function(H,maxiter) {
    if(typeof maxiter === "undefined") { maxiter = 10000; }
    H = numeric.clone(H);
    var H0 = numeric.clone(H);
    var s = numeric.dim(H),m=s[0],x,v,a,b,c,d,det,tr, Hloc, Q = numeric.identity(m), Qi, Hi, B, C, Ci,i,j,k,iter;
    if(m<3) { return {Q:Q, B:[ [0,m-1] ]}; }
    var epsilon = numeric.epsilon;
    for(iter=0;iter<maxiter;iter++) {
        for(j=0;j<m-1;j++) {
            if(Math.abs(H[j+1][j]) < epsilon*(Math.abs(H[j][j])+Math.abs(H[j+1][j+1]))) {
                var QH1 = numeric.QRFrancis(numeric.getBlock(H,[0,0],[j,j]),maxiter);
                var QH2 = numeric.QRFrancis(numeric.getBlock(H,[j+1,j+1],[m-1,m-1]),maxiter);
                B = Array(j+1);
                for(i=0;i<=j;i++) { B[i] = Q[i]; }
                C = numeric.dot(QH1.Q,B);
                for(i=0;i<=j;i++) { Q[i] = C[i]; }
                B = Array(m-j-1);
                for(i=j+1;i<m;i++) { B[i-j-1] = Q[i]; }
                C = numeric.dot(QH2.Q,B);
                for(i=j+1;i<m;i++) { Q[i] = C[i-j-1]; }
                return {Q:Q,B:QH1.B.concat(numeric.add(QH2.B,j+1))};
            }
        }
        a = H[m-2][m-2]; b = H[m-2][m-1];
        c = H[m-1][m-2]; d = H[m-1][m-1];
        tr = a+d;
        det = (a*d-b*c);
        Hloc = numeric.getBlock(H, [0,0], [2,2]);
        if(tr*tr>=4*det) {
            var s1,s2;
            s1 = 0.5*(tr+Math.sqrt(tr*tr-4*det));
            s2 = 0.5*(tr-Math.sqrt(tr*tr-4*det));
            Hloc = numeric.add(numeric.sub(numeric.dot(Hloc,Hloc),
                                           numeric.mul(Hloc,s1+s2)),
                               numeric.diag(numeric.rep([3],s1*s2)));
        } else {
            Hloc = numeric.add(numeric.sub(numeric.dot(Hloc,Hloc),
                                           numeric.mul(Hloc,tr)),
                               numeric.diag(numeric.rep([3],det)));
        }
        x = [Hloc[0][0],Hloc[1][0],Hloc[2][0]];
        v = numeric.house(x);
        B = [H[0],H[1],H[2]];
        C = numeric.tensor(v,numeric.dot(v,B));
        for(i=0;i<3;i++) { Hi = H[i]; Ci = C[i]; for(k=0;k<m;k++) Hi[k] -= 2*Ci[k]; }
        B = numeric.getBlock(H, [0,0],[m-1,2]);
        C = numeric.tensor(numeric.dot(B,v),v);
        for(i=0;i<m;i++) { Hi = H[i]; Ci = C[i]; for(k=0;k<3;k++) Hi[k] -= 2*Ci[k]; }
        B = [Q[0],Q[1],Q[2]];
        C = numeric.tensor(v,numeric.dot(v,B));
        for(i=0;i<3;i++) { Qi = Q[i]; Ci = C[i]; for(k=0;k<m;k++) Qi[k] -= 2*Ci[k]; }
        var J;
        for(j=0;j<m-2;j++) {
            for(k=j;k<=j+1;k++) {
                if(Math.abs(H[k+1][k]) < epsilon*(Math.abs(H[k][k])+Math.abs(H[k+1][k+1]))) {
                    var QH1 = numeric.QRFrancis(numeric.getBlock(H,[0,0],[k,k]),maxiter);
                    var QH2 = numeric.QRFrancis(numeric.getBlock(H,[k+1,k+1],[m-1,m-1]),maxiter);
                    B = Array(k+1);
                    for(i=0;i<=k;i++) { B[i] = Q[i]; }
                    C = numeric.dot(QH1.Q,B);
                    for(i=0;i<=k;i++) { Q[i] = C[i]; }
                    B = Array(m-k-1);
                    for(i=k+1;i<m;i++) { B[i-k-1] = Q[i]; }
                    C = numeric.dot(QH2.Q,B);
                    for(i=k+1;i<m;i++) { Q[i] = C[i-k-1]; }
                    return {Q:Q,B:QH1.B.concat(numeric.add(QH2.B,k+1))};
                }
            }
            J = Math.min(m-1,j+3);
            x = Array(J-j);
            for(i=j+1;i<=J;i++) { x[i-j-1] = H[i][j]; }
            v = numeric.house(x);
            B = numeric.getBlock(H, [j+1,j],[J,m-1]);
            C = numeric.tensor(v,numeric.dot(v,B));
            for(i=j+1;i<=J;i++) { Hi = H[i]; Ci = C[i-j-1]; for(k=j;k<m;k++) Hi[k] -= 2*Ci[k-j]; }
            B = numeric.getBlock(H, [0,j+1],[m-1,J]);
            C = numeric.tensor(numeric.dot(B,v),v);
            for(i=0;i<m;i++) { Hi = H[i]; Ci = C[i]; for(k=j+1;k<=J;k++) Hi[k] -= 2*Ci[k-j-1]; }
            B = Array(J-j);
            for(i=j+1;i<=J;i++) B[i-j-1] = Q[i];
            C = numeric.tensor(v,numeric.dot(v,B));
            for(i=j+1;i<=J;i++) { Qi = Q[i]; Ci = C[i-j-1]; for(k=0;k<m;k++) Qi[k] -= 2*Ci[k]; }
        }
    }
    throw new Error('numeric: eigenvalue iteration does not converge -- increase maxiter?');
}

numeric.eig = function eig(A,maxiter) {
    var QH = numeric.toUpperHessenberg(A);
    var QB = numeric.QRFrancis(QH.H,maxiter);
    var T = numeric.T;
    var n = A.length,i,k,flag = false,B = QB.B,H = numeric.dot(QB.Q,numeric.dot(QH.H,numeric.transpose(QB.Q)));
    var Q = new T(numeric.dot(QB.Q,QH.Q)),Q0;
    var m = B.length,j;
    var a,b,c,d,p1,p2,disc,x,y,p,q,n1,n2;
    var sqrt = Math.sqrt;
    for(k=0;k<m;k++) {
        i = B[k][0];
        if(i === B[k][1]) {
            // nothing
        } else {
            j = i+1;
            a = H[i][i];
            b = H[i][j];
            c = H[j][i];
            d = H[j][j];
            if(b === 0 && c === 0) continue;
            p1 = -a-d;
            p2 = a*d-b*c;
            disc = p1*p1-4*p2;
            if(disc>=0) {
                if(p1<0) x = -0.5*(p1-sqrt(disc));
                else     x = -0.5*(p1+sqrt(disc));
                n1 = (a-x)*(a-x)+b*b;
                n2 = c*c+(d-x)*(d-x);
                if(n1>n2) {
                    n1 = sqrt(n1);
                    p = (a-x)/n1;
                    q = b/n1;
                } else {
                    n2 = sqrt(n2);
                    p = c/n2;
                    q = (d-x)/n2;
                }
                Q0 = new T([[q,-p],[p,q]]);
                Q.setRows(i,j,Q0.dot(Q.getRows(i,j)));
            } else {
                x = -0.5*p1;
                y = 0.5*sqrt(-disc);
                n1 = (a-x)*(a-x)+b*b;
                n2 = c*c+(d-x)*(d-x);
                if(n1>n2) {
                    n1 = sqrt(n1+y*y);
                    p = (a-x)/n1;
                    q = b/n1;
                    x = 0;
                    y /= n1;
                } else {
                    n2 = sqrt(n2+y*y);
                    p = c/n2;
                    q = (d-x)/n2;
                    x = y/n2;
                    y = 0;
                }
                Q0 = new T([[q,-p],[p,q]],[[x,y],[y,-x]]);
                Q.setRows(i,j,Q0.dot(Q.getRows(i,j)));
            }
        }
    }
    var R = Q.dot(A).dot(Q.transjugate()), n = A.length, E = numeric.T.identity(n);
    for(j=0;j<n;j++) {
        if(j>0) {
            for(k=j-1;k>=0;k--) {
                var Rk = R.get([k,k]), Rj = R.get([j,j]);
                if(numeric.neq(Rk.x,Rj.x) || numeric.neq(Rk.y,Rj.y)) {
                    x = R.getRow(k).getBlock([k],[j-1]);
                    y = E.getRow(j).getBlock([k],[j-1]);
                    E.set([j,k],(R.get([k,j]).neg().sub(x.dot(y))).div(Rk.sub(Rj)));
                } else {
                    E.setRow(j,E.getRow(k));
                    continue;
                }
            }
        }
    }
    for(j=0;j<n;j++) {
        x = E.getRow(j);
        E.setRow(j,x.div(x.norm2()));
    }
    E = E.transpose();
    E = Q.transjugate().dot(E);
    return { lambda:R.getDiag(), E:E };
};

// 5. Compressed Column Storage matrices
numeric.ccsSparse = function ccsSparse(A) {
    var m = A.length,n,foo, i,j, counts = [];
    for(i=m-1;i!==-1;--i) {
        foo = A[i];
        for(j in foo) {
            j = parseInt(j);
            while(j>=counts.length) counts[counts.length] = 0;
            if(foo[j]!==0) counts[j]++;
        }
    }
    var n = counts.length;
    var Ai = Array(n+1);
    Ai[0] = 0;
    for(i=0;i<n;++i) Ai[i+1] = Ai[i] + counts[i];
    var Aj = Array(Ai[n]), Av = Array(Ai[n]);
    for(i=m-1;i!==-1;--i) {
        foo = A[i];
        for(j in foo) {
            if(foo[j]!==0) {
                counts[j]--;
                Aj[Ai[j]+counts[j]] = i;
                Av[Ai[j]+counts[j]] = foo[j];
            }
        }
    }
    return [Ai,Aj,Av];
}
numeric.ccsFull = function ccsFull(A) {
    var Ai = A[0], Aj = A[1], Av = A[2], s = numeric.ccsDim(A), m = s[0], n = s[1], i,j,j0,j1,k;
    var B = numeric.rep([m,n],0);
    for(i=0;i<n;i++) {
        j0 = Ai[i];
        j1 = Ai[i+1];
        for(j=j0;j<j1;++j) { B[Aj[j]][i] = Av[j]; }
    }
    return B;
}
numeric.ccsTSolve = function ccsTSolve(A,b,x,bj,xj) {
    var Ai = A[0], Aj = A[1], Av = A[2],m = Ai.length-1, max = Math.max,n=0;
    if(typeof bj === "undefined") x = numeric.rep([m],0);
    if(typeof bj === "undefined") bj = numeric.linspace(0,x.length-1);
    if(typeof xj === "undefined") xj = [];
    function dfs(j) {
        var k;
        if(x[j] !== 0) return;
        x[j] = 1;
        for(k=Ai[j];k<Ai[j+1];++k) dfs(Aj[k]);
        xj[n] = j;
        ++n;
    }
    var i,j,j0,j1,k,l,l0,l1,a;
    for(i=bj.length-1;i!==-1;--i) { dfs(bj[i]); }
    xj.length = n;
    for(i=xj.length-1;i!==-1;--i) { x[xj[i]] = 0; }
    for(i=bj.length-1;i!==-1;--i) { j = bj[i]; x[j] = b[j]; }
    for(i=xj.length-1;i!==-1;--i) {
        j = xj[i];
        j0 = Ai[j];
        j1 = max(Ai[j+1],j0);
        for(k=j0;k!==j1;++k) { if(Aj[k] === j) { x[j] /= Av[k]; break; } }
        a = x[j];
        for(k=j0;k!==j1;++k) {
            l = Aj[k];
            if(l !== j) x[l] -= a*Av[k];
        }
    }
    return x;
}
numeric.ccsDFS = function ccsDFS(n) {
    this.k = Array(n);
    this.k1 = Array(n);
    this.j = Array(n);
}
numeric.ccsDFS.prototype.dfs = function dfs(J,Ai,Aj,x,xj,Pinv) {
    var m = 0,foo,n=xj.length;
    var k = this.k, k1 = this.k1, j = this.j,km,k11;
    if(x[J]!==0) return;
    x[J] = 1;
    j[0] = J;
    k[0] = km = Ai[J];
    k1[0] = k11 = Ai[J+1];
    while(1) {
        if(km >= k11) {
            xj[n] = j[m];
            if(m===0) return;
            ++n;
            --m;
            km = k[m];
            k11 = k1[m];
        } else {
            foo = Pinv[Aj[km]];
            if(x[foo] === 0) {
                x[foo] = 1;
                k[m] = km;
                ++m;
                j[m] = foo;
                km = Ai[foo];
                k1[m] = k11 = Ai[foo+1];
            } else ++km;
        }
    }
}
numeric.ccsLPSolve = function ccsLPSolve(A,B,x,xj,I,Pinv,dfs) {
    var Ai = A[0], Aj = A[1], Av = A[2],m = Ai.length-1, n=0;
    var Bi = B[0], Bj = B[1], Bv = B[2];
    
    var i,i0,i1,j,J,j0,j1,k,l,l0,l1,a;
    i0 = Bi[I];
    i1 = Bi[I+1];
    xj.length = 0;
    for(i=i0;i<i1;++i) { dfs.dfs(Pinv[Bj[i]],Ai,Aj,x,xj,Pinv); }
    for(i=xj.length-1;i!==-1;--i) { x[xj[i]] = 0; }
    for(i=i0;i!==i1;++i) { j = Pinv[Bj[i]]; x[j] = Bv[i]; }
    for(i=xj.length-1;i!==-1;--i) {
        j = xj[i];
        j0 = Ai[j];
        j1 = Ai[j+1];
        for(k=j0;k<j1;++k) { if(Pinv[Aj[k]] === j) { x[j] /= Av[k]; break; } }
        a = x[j];
        for(k=j0;k<j1;++k) {
            l = Pinv[Aj[k]];
            if(l !== j) x[l] -= a*Av[k];
        }
    }
    return x;
}
numeric.ccsLUP1 = function ccsLUP1(A,threshold) {
    var m = A[0].length-1;
    var L = [numeric.rep([m+1],0),[],[]], U = [numeric.rep([m+1], 0),[],[]];
    var Li = L[0], Lj = L[1], Lv = L[2], Ui = U[0], Uj = U[1], Uv = U[2];
    var x = numeric.rep([m],0), xj = numeric.rep([m],0);
    var i,j,k,j0,j1,a,e,c,d,K;
    var sol = numeric.ccsLPSolve, max = Math.max, abs = Math.abs;
    var P = numeric.linspace(0,m-1),Pinv = numeric.linspace(0,m-1);
    var dfs = new numeric.ccsDFS(m);
    if(typeof threshold === "undefined") { threshold = 1; }
    for(i=0;i<m;++i) {
        sol(L,A,x,xj,i,Pinv,dfs);
        a = -1;
        e = -1;
        for(j=xj.length-1;j!==-1;--j) {
            k = xj[j];
            if(k <= i) continue;
            c = abs(x[k]);
            if(c > a) { e = k; a = c; }
        }
        if(abs(x[i])<threshold*a) {
            j = P[i];
            a = P[e];
            P[i] = a; Pinv[a] = i;
            P[e] = j; Pinv[j] = e;
            a = x[i]; x[i] = x[e]; x[e] = a;
        }
        a = Li[i];
        e = Ui[i];
        d = x[i];
        Lj[a] = P[i];
        Lv[a] = 1;
        ++a;
        for(j=xj.length-1;j!==-1;--j) {
            k = xj[j];
            c = x[k];
            xj[j] = 0;
            x[k] = 0;
            if(k<=i) { Uj[e] = k; Uv[e] = c;   ++e; }
            else     { Lj[a] = P[k]; Lv[a] = c/d; ++a; }
        }
        Li[i+1] = a;
        Ui[i+1] = e;
    }
    for(j=Lj.length-1;j!==-1;--j) { Lj[j] = Pinv[Lj[j]]; }
    return {L:L, U:U, P:P, Pinv:Pinv};
}
numeric.ccsDFS0 = function ccsDFS0(n) {
    this.k = Array(n);
    this.k1 = Array(n);
    this.j = Array(n);
}
numeric.ccsDFS0.prototype.dfs = function dfs(J,Ai,Aj,x,xj,Pinv,P) {
    var m = 0,foo,n=xj.length;
    var k = this.k, k1 = this.k1, j = this.j,km,k11;
    if(x[J]!==0) return;
    x[J] = 1;
    j[0] = J;
    k[0] = km = Ai[Pinv[J]];
    k1[0] = k11 = Ai[Pinv[J]+1];
    while(1) {
        if(isNaN(km)) throw new Error("Ow!");
        if(km >= k11) {
            xj[n] = Pinv[j[m]];
            if(m===0) return;
            ++n;
            --m;
            km = k[m];
            k11 = k1[m];
        } else {
            foo = Aj[km];
            if(x[foo] === 0) {
                x[foo] = 1;
                k[m] = km;
                ++m;
                j[m] = foo;
                foo = Pinv[foo];
                km = Ai[foo];
                k1[m] = k11 = Ai[foo+1];
            } else ++km;
        }
    }
}
numeric.ccsLPSolve0 = function ccsLPSolve0(A,B,y,xj,I,Pinv,P,dfs) {
    var Ai = A[0], Aj = A[1], Av = A[2],m = Ai.length-1, n=0;
    var Bi = B[0], Bj = B[1], Bv = B[2];
    
    var i,i0,i1,j,J,j0,j1,k,l,l0,l1,a;
    i0 = Bi[I];
    i1 = Bi[I+1];
    xj.length = 0;
    for(i=i0;i<i1;++i) { dfs.dfs(Bj[i],Ai,Aj,y,xj,Pinv,P); }
    for(i=xj.length-1;i!==-1;--i) { j = xj[i]; y[P[j]] = 0; }
    for(i=i0;i!==i1;++i) { j = Bj[i]; y[j] = Bv[i]; }
    for(i=xj.length-1;i!==-1;--i) {
        j = xj[i];
        l = P[j];
        j0 = Ai[j];
        j1 = Ai[j+1];
        for(k=j0;k<j1;++k) { if(Aj[k] === l) { y[l] /= Av[k]; break; } }
        a = y[l];
        for(k=j0;k<j1;++k) y[Aj[k]] -= a*Av[k];
        y[l] = a;
    }
}
numeric.ccsLUP0 = function ccsLUP0(A,threshold) {
    var m = A[0].length-1;
    var L = [numeric.rep([m+1],0),[],[]], U = [numeric.rep([m+1], 0),[],[]];
    var Li = L[0], Lj = L[1], Lv = L[2], Ui = U[0], Uj = U[1], Uv = U[2];
    var y = numeric.rep([m],0), xj = numeric.rep([m],0);
    var i,j,k,j0,j1,a,e,c,d,K;
    var sol = numeric.ccsLPSolve0, max = Math.max, abs = Math.abs;
    var P = numeric.linspace(0,m-1),Pinv = numeric.linspace(0,m-1);
    var dfs = new numeric.ccsDFS0(m);
    if(typeof threshold === "undefined") { threshold = 1; }
    for(i=0;i<m;++i) {
        sol(L,A,y,xj,i,Pinv,P,dfs);
        a = -1;
        e = -1;
        for(j=xj.length-1;j!==-1;--j) {
            k = xj[j];
            if(k <= i) continue;
            c = abs(y[P[k]]);
            if(c > a) { e = k; a = c; }
        }
        if(abs(y[P[i]])<threshold*a) {
            j = P[i];
            a = P[e];
            P[i] = a; Pinv[a] = i;
            P[e] = j; Pinv[j] = e;
        }
        a = Li[i];
        e = Ui[i];
        d = y[P[i]];
        Lj[a] = P[i];
        Lv[a] = 1;
        ++a;
        for(j=xj.length-1;j!==-1;--j) {
            k = xj[j];
            c = y[P[k]];
            xj[j] = 0;
            y[P[k]] = 0;
            if(k<=i) { Uj[e] = k; Uv[e] = c;   ++e; }
            else     { Lj[a] = P[k]; Lv[a] = c/d; ++a; }
        }
        Li[i+1] = a;
        Ui[i+1] = e;
    }
    for(j=Lj.length-1;j!==-1;--j) { Lj[j] = Pinv[Lj[j]]; }
    return {L:L, U:U, P:P, Pinv:Pinv};
}
numeric.ccsLUP = numeric.ccsLUP0;

numeric.ccsDim = function ccsDim(A) { return [numeric.sup(A[1])+1,A[0].length-1]; }
numeric.ccsGetBlock = function ccsGetBlock(A,i,j) {
    var s = numeric.ccsDim(A),m=s[0],n=s[1];
    if(typeof i === "undefined") { i = numeric.linspace(0,m-1); }
    else if(typeof i === "number") { i = [i]; }
    if(typeof j === "undefined") { j = numeric.linspace(0,n-1); }
    else if(typeof j === "number") { j = [j]; }
    var p,p0,p1,P = i.length,q,Q = j.length,r,jq,ip;
    var Bi = numeric.rep([n],0), Bj=[], Bv=[], B = [Bi,Bj,Bv];
    var Ai = A[0], Aj = A[1], Av = A[2];
    var x = numeric.rep([m],0),count=0,flags = numeric.rep([m],0);
    for(q=0;q<Q;++q) {
        jq = j[q];
        var q0 = Ai[jq];
        var q1 = Ai[jq+1];
        for(p=q0;p<q1;++p) {
            r = Aj[p];
            flags[r] = 1;
            x[r] = Av[p];
        }
        for(p=0;p<P;++p) {
            ip = i[p];
            if(flags[ip]) {
                Bj[count] = p;
                Bv[count] = x[i[p]];
                ++count;
            }
        }
        for(p=q0;p<q1;++p) {
            r = Aj[p];
            flags[r] = 0;
        }
        Bi[q+1] = count;
    }
    return B;
}

numeric.ccsDot = function ccsDot(A,B) {
    var Ai = A[0], Aj = A[1], Av = A[2];
    var Bi = B[0], Bj = B[1], Bv = B[2];
    var sA = numeric.ccsDim(A), sB = numeric.ccsDim(B);
    var m = sA[0], n = sA[1], o = sB[1];
    var x = numeric.rep([m],0), flags = numeric.rep([m],0), xj = Array(m);
    var Ci = numeric.rep([o],0), Cj = [], Cv = [], C = [Ci,Cj,Cv];
    var i,j,k,j0,j1,i0,i1,l,p,a,b;
    for(k=0;k!==o;++k) {
        j0 = Bi[k];
        j1 = Bi[k+1];
        p = 0;
        for(j=j0;j<j1;++j) {
            a = Bj[j];
            b = Bv[j];
            i0 = Ai[a];
            i1 = Ai[a+1];
            for(i=i0;i<i1;++i) {
                l = Aj[i];
                if(flags[l]===0) {
                    xj[p] = l;
                    flags[l] = 1;
                    p = p+1;
                }
                x[l] = x[l] + Av[i]*b;
            }
        }
        j0 = Ci[k];
        j1 = j0+p;
        Ci[k+1] = j1;
        for(j=p-1;j!==-1;--j) {
            b = j0+j;
            i = xj[j];
            Cj[b] = i;
            Cv[b] = x[i];
            flags[i] = 0;
            x[i] = 0;
        }
        Ci[k+1] = Ci[k]+p;
    }
    return C;
}

numeric.ccsLUPSolve = function ccsLUPSolve(LUP,B) {
    var L = LUP.L, U = LUP.U, P = LUP.P;
    var Bi = B[0];
    var flag = false;
    if(typeof Bi !== "object") { B = [[0,B.length],numeric.linspace(0,B.length-1),B]; Bi = B[0]; flag = true; }
    var Bj = B[1], Bv = B[2];
    var n = L[0].length-1, m = Bi.length-1;
    var x = numeric.rep([n],0), xj = Array(n);
    var b = numeric.rep([n],0), bj = Array(n);
    var Xi = numeric.rep([m+1],0), Xj = [], Xv = [];
    var sol = numeric.ccsTSolve;
    var i,j,j0,j1,k,J,N=0;
    for(i=0;i<m;++i) {
        k = 0;
        j0 = Bi[i];
        j1 = Bi[i+1];
        for(j=j0;j<j1;++j) { 
            J = LUP.Pinv[Bj[j]];
            bj[k] = J;
            b[J] = Bv[j];
            ++k;
        }
        bj.length = k;
        sol(L,b,x,bj,xj);
        for(j=bj.length-1;j!==-1;--j) b[bj[j]] = 0;
        sol(U,x,b,xj,bj);
        if(flag) return b;
        for(j=xj.length-1;j!==-1;--j) x[xj[j]] = 0;
        for(j=bj.length-1;j!==-1;--j) {
            J = bj[j];
            Xj[N] = J;
            Xv[N] = b[J];
            b[J] = 0;
            ++N;
        }
        Xi[i+1] = N;
    }
    return [Xi,Xj,Xv];
}

numeric.ccsbinop = function ccsbinop(body,setup) {
    if(typeof setup === "undefined") setup='';
    return Function('X','Y',
            'var Xi = X[0], Xj = X[1], Xv = X[2];\n'+
            'var Yi = Y[0], Yj = Y[1], Yv = Y[2];\n'+
            'var n = Xi.length-1,m = Math.max(numeric.sup(Xj),numeric.sup(Yj))+1;\n'+
            'var Zi = numeric.rep([n+1],0), Zj = [], Zv = [];\n'+
            'var x = numeric.rep([m],0),y = numeric.rep([m],0);\n'+
            'var xk,yk,zk;\n'+
            'var i,j,j0,j1,k,p=0;\n'+
            setup+
            'for(i=0;i<n;++i) {\n'+
            '  j0 = Xi[i]; j1 = Xi[i+1];\n'+
            '  for(j=j0;j!==j1;++j) {\n'+
            '    k = Xj[j];\n'+
            '    x[k] = 1;\n'+
            '    Zj[p] = k;\n'+
            '    ++p;\n'+
            '  }\n'+
            '  j0 = Yi[i]; j1 = Yi[i+1];\n'+
            '  for(j=j0;j!==j1;++j) {\n'+
            '    k = Yj[j];\n'+
            '    y[k] = Yv[j];\n'+
            '    if(x[k] === 0) {\n'+
            '      Zj[p] = k;\n'+
            '      ++p;\n'+
            '    }\n'+
            '  }\n'+
            '  Zi[i+1] = p;\n'+
            '  j0 = Xi[i]; j1 = Xi[i+1];\n'+
            '  for(j=j0;j!==j1;++j) x[Xj[j]] = Xv[j];\n'+
            '  j0 = Zi[i]; j1 = Zi[i+1];\n'+
            '  for(j=j0;j!==j1;++j) {\n'+
            '    k = Zj[j];\n'+
            '    xk = x[k];\n'+
            '    yk = y[k];\n'+
            body+'\n'+
            '    Zv[j] = zk;\n'+
            '  }\n'+
            '  j0 = Xi[i]; j1 = Xi[i+1];\n'+
            '  for(j=j0;j!==j1;++j) x[Xj[j]] = 0;\n'+
            '  j0 = Yi[i]; j1 = Yi[i+1];\n'+
            '  for(j=j0;j!==j1;++j) y[Yj[j]] = 0;\n'+
            '}\n'+
            'return [Zi,Zj,Zv];'
            );
};

(function() {
    var k,A,B,C;
    for(k in numeric.ops2) {
        if(isFinite(eval('1'+numeric.ops2[k]+'0'))) A = '[Y[0],Y[1],numeric.'+k+'(X,Y[2])]';
        else A = 'NaN';
        if(isFinite(eval('0'+numeric.ops2[k]+'1'))) B = '[X[0],X[1],numeric.'+k+'(X[2],Y)]';
        else B = 'NaN';
        if(isFinite(eval('1'+numeric.ops2[k]+'0')) && isFinite(eval('0'+numeric.ops2[k]+'1'))) C = 'numeric.ccs'+k+'MM(X,Y)';
        else C = 'NaN';
        numeric['ccs'+k+'MM'] = numeric.ccsbinop('zk = xk '+numeric.ops2[k]+'yk;');
        numeric['ccs'+k] = Function('X','Y',
                'if(typeof X === "number") return '+A+';\n'+
                'if(typeof Y === "number") return '+B+';\n'+
                'return '+C+';\n'
                );
    }
}());

numeric.ccsScatter = function ccsScatter(A) {
    var Ai = A[0], Aj = A[1], Av = A[2];
    var n = numeric.sup(Aj)+1,m=Ai.length;
    var Ri = numeric.rep([n],0),Rj=Array(m), Rv = Array(m);
    var counts = numeric.rep([n],0),i;
    for(i=0;i<m;++i) counts[Aj[i]]++;
    for(i=0;i<n;++i) Ri[i+1] = Ri[i] + counts[i];
    var ptr = Ri.slice(0),k,Aii;
    for(i=0;i<m;++i) {
        Aii = Aj[i];
        k = ptr[Aii];
        Rj[k] = Ai[i];
        Rv[k] = Av[i];
        ptr[Aii]=ptr[Aii]+1;
    }
    return [Ri,Rj,Rv];
}

numeric.ccsGather = function ccsGather(A) {
    var Ai = A[0], Aj = A[1], Av = A[2];
    var n = Ai.length-1,m = Aj.length;
    var Ri = Array(m), Rj = Array(m), Rv = Array(m);
    var i,j,j0,j1,p;
    p=0;
    for(i=0;i<n;++i) {
        j0 = Ai[i];
        j1 = Ai[i+1];
        for(j=j0;j!==j1;++j) {
            Rj[p] = i;
            Ri[p] = Aj[j];
            Rv[p] = Av[j];
            ++p;
        }
    }
    return [Ri,Rj,Rv];
}

// The following sparse linear algebra routines are deprecated.

numeric.sdim = function dim(A,ret,k) {
    if(typeof ret === "undefined") { ret = []; }
    if(typeof A !== "object") return ret;
    if(typeof k === "undefined") { k=0; }
    if(!(k in ret)) { ret[k] = 0; }
    if(A.length > ret[k]) ret[k] = A.length;
    var i;
    for(i in A) {
        if(A.hasOwnProperty(i)) dim(A[i],ret,k+1);
    }
    return ret;
};

numeric.sclone = function clone(A,k,n) {
    if(typeof k === "undefined") { k=0; }
    if(typeof n === "undefined") { n = numeric.sdim(A).length; }
    var i,ret = Array(A.length);
    if(k === n-1) {
        for(i in A) { if(A.hasOwnProperty(i)) ret[i] = A[i]; }
        return ret;
    }
    for(i in A) {
        if(A.hasOwnProperty(i)) ret[i] = clone(A[i],k+1,n);
    }
    return ret;
}

numeric.sdiag = function diag(d) {
    var n = d.length,i,ret = Array(n),i1,i2,i3;
    for(i=n-1;i>=1;i-=2) {
        i1 = i-1;
        ret[i] = []; ret[i][i] = d[i];
        ret[i1] = []; ret[i1][i1] = d[i1];
    }
    if(i===0) { ret[0] = []; ret[0][0] = d[i]; }
    return ret;
}

numeric.sidentity = function identity(n) { return numeric.sdiag(numeric.rep([n],1)); }

numeric.stranspose = function transpose(A) {
    var ret = [], n = A.length, i,j,Ai;
    for(i in A) {
        if(!(A.hasOwnProperty(i))) continue;
        Ai = A[i];
        for(j in Ai) {
            if(!(Ai.hasOwnProperty(j))) continue;
            if(typeof ret[j] !== "object") { ret[j] = []; }
            ret[j][i] = Ai[j];
        }
    }
    return ret;
}

numeric.sLUP = function LUP(A,tol) {
    throw new Error("The function numeric.sLUP had a bug in it and has been removed. Please use the new numeric.ccsLUP function instead.");
};

numeric.sdotMM = function dotMM(A,B) {
    var p = A.length, q = B.length, BT = numeric.stranspose(B), r = BT.length, Ai, BTk;
    var i,j,k,accum;
    var ret = Array(p),reti;
    for(i=p-1;i>=0;i--) {
        reti = [];
        Ai = A[i];
        for(k=r-1;k>=0;k--) {
            accum = 0;
            BTk = BT[k];
            for(j in Ai) {
                if(!(Ai.hasOwnProperty(j))) continue;
                if(j in BTk) { accum += Ai[j]*BTk[j]; }
            }
            if(accum) reti[k] = accum;
        }
        ret[i] = reti;
    }
    return ret;
}

numeric.sdotMV = function dotMV(A,x) {
    var p = A.length, Ai, i,j;
    var ret = Array(p), accum;
    for(i=p-1;i>=0;i--) {
        Ai = A[i];
        accum = 0;
        for(j in Ai) {
            if(!(Ai.hasOwnProperty(j))) continue;
            if(x[j]) accum += Ai[j]*x[j];
        }
        if(accum) ret[i] = accum;
    }
    return ret;
}

numeric.sdotVM = function dotMV(x,A) {
    var i,j,Ai,alpha;
    var ret = [], accum;
    for(i in x) {
        if(!x.hasOwnProperty(i)) continue;
        Ai = A[i];
        alpha = x[i];
        for(j in Ai) {
            if(!Ai.hasOwnProperty(j)) continue;
            if(!ret[j]) { ret[j] = 0; }
            ret[j] += alpha*Ai[j];
        }
    }
    return ret;
}

numeric.sdotVV = function dotVV(x,y) {
    var i,ret=0;
    for(i in x) { if(x[i] && y[i]) ret+= x[i]*y[i]; }
    return ret;
}

numeric.sdot = function dot(A,B) {
    var m = numeric.sdim(A).length, n = numeric.sdim(B).length;
    var k = m*1000+n;
    switch(k) {
    case 0: return A*B;
    case 1001: return numeric.sdotVV(A,B);
    case 2001: return numeric.sdotMV(A,B);
    case 1002: return numeric.sdotVM(A,B);
    case 2002: return numeric.sdotMM(A,B);
    default: throw new Error('numeric.sdot not implemented for tensors of order '+m+' and '+n);
    }
}

numeric.sscatter = function scatter(V) {
    var n = V[0].length, Vij, i, j, m = V.length, A = [], Aj;
    for(i=n-1;i>=0;--i) {
        if(!V[m-1][i]) continue;
        Aj = A;
        for(j=0;j<m-2;j++) {
            Vij = V[j][i];
            if(!Aj[Vij]) Aj[Vij] = [];
            Aj = Aj[Vij];
        }
        Aj[V[j][i]] = V[j+1][i];
    }
    return A;
}

numeric.sgather = function gather(A,ret,k) {
    if(typeof ret === "undefined") ret = [];
    if(typeof k === "undefined") k = [];
    var n,i,Ai;
    n = k.length;
    for(i in A) {
        if(A.hasOwnProperty(i)) {
            k[n] = parseInt(i);
            Ai = A[i];
            if(typeof Ai === "number") {
                if(Ai) {
                    if(ret.length === 0) {
                        for(i=n+1;i>=0;--i) ret[i] = [];
                    }
                    for(i=n;i>=0;--i) ret[i].push(k[i]);
                    ret[n+1].push(Ai);
                }
            } else gather(Ai,ret,k);
        }
    }
    if(k.length>n) k.pop();
    return ret;
}

// 6. Coordinate matrices
numeric.cLU = function LU(A) {
    var I = A[0], J = A[1], V = A[2];
    var p = I.length, m=0, i,j,k,a,b,c;
    for(i=0;i<p;i++) if(I[i]>m) m=I[i];
    m++;
    var L = Array(m), U = Array(m), left = numeric.rep([m],Infinity), right = numeric.rep([m],-Infinity);
    var Ui, Uj,alpha;
    for(k=0;k<p;k++) {
        i = I[k];
        j = J[k];
        if(j<left[i]) left[i] = j;
        if(j>right[i]) right[i] = j;
    }
    for(i=0;i<m-1;i++) { if(right[i] > right[i+1]) right[i+1] = right[i]; }
    for(i=m-1;i>=1;i--) { if(left[i]<left[i-1]) left[i-1] = left[i]; }
    var countL = 0, countU = 0;
    for(i=0;i<m;i++) {
        U[i] = numeric.rep([right[i]-left[i]+1],0);
        L[i] = numeric.rep([i-left[i]],0);
        countL += i-left[i]+1;
        countU += right[i]-i+1;
    }
    for(k=0;k<p;k++) { i = I[k]; U[i][J[k]-left[i]] = V[k]; }
    for(i=0;i<m-1;i++) {
        a = i-left[i];
        Ui = U[i];
        for(j=i+1;left[j]<=i && j<m;j++) {
            b = i-left[j];
            c = right[i]-i;
            Uj = U[j];
            alpha = Uj[b]/Ui[a];
            if(alpha) {
                for(k=1;k<=c;k++) { Uj[k+b] -= alpha*Ui[k+a]; }
                L[j][i-left[j]] = alpha;
            }
        }
    }
    var Ui = [], Uj = [], Uv = [], Li = [], Lj = [], Lv = [];
    var p,q,foo;
    p=0; q=0;
    for(i=0;i<m;i++) {
        a = left[i];
        b = right[i];
        foo = U[i];
        for(j=i;j<=b;j++) {
            if(foo[j-a]) {
                Ui[p] = i;
                Uj[p] = j;
                Uv[p] = foo[j-a];
                p++;
            }
        }
        foo = L[i];
        for(j=a;j<i;j++) {
            if(foo[j-a]) {
                Li[q] = i;
                Lj[q] = j;
                Lv[q] = foo[j-a];
                q++;
            }
        }
        Li[q] = i;
        Lj[q] = i;
        Lv[q] = 1;
        q++;
    }
    return {U:[Ui,Uj,Uv], L:[Li,Lj,Lv]};
};

numeric.cLUsolve = function LUsolve(lu,b) {
    var L = lu.L, U = lu.U, ret = numeric.clone(b);
    var Li = L[0], Lj = L[1], Lv = L[2];
    var Ui = U[0], Uj = U[1], Uv = U[2];
    var p = Ui.length, q = Li.length;
    var m = ret.length,i,j,k;
    k = 0;
    for(i=0;i<m;i++) {
        while(Lj[k] < i) {
            ret[i] -= Lv[k]*ret[Lj[k]];
            k++;
        }
        k++;
    }
    k = p-1;
    for(i=m-1;i>=0;i--) {
        while(Uj[k] > i) {
            ret[i] -= Uv[k]*ret[Uj[k]];
            k--;
        }
        ret[i] /= Uv[k];
        k--;
    }
    return ret;
};

numeric.cgrid = function grid(n,shape) {
    if(typeof n === "number") n = [n,n];
    var ret = numeric.rep(n,-1);
    var i,j,count;
    if(typeof shape !== "function") {
        switch(shape) {
        case 'L':
            shape = function(i,j) { return (i>=n[0]/2 || j<n[1]/2); }
            break;
        default:
            shape = function(i,j) { return true; };
            break;
        }
    }
    count=0;
    for(i=1;i<n[0]-1;i++) for(j=1;j<n[1]-1;j++) 
        if(shape(i,j)) {
            ret[i][j] = count;
            count++;
        }
    return ret;
}

numeric.cdelsq = function delsq(g) {
    var dir = [[-1,0],[0,-1],[0,1],[1,0]];
    var s = numeric.dim(g), m = s[0], n = s[1], i,j,k,p,q;
    var Li = [], Lj = [], Lv = [];
    for(i=1;i<m-1;i++) for(j=1;j<n-1;j++) {
        if(g[i][j]<0) continue;
        for(k=0;k<4;k++) {
            p = i+dir[k][0];
            q = j+dir[k][1];
            if(g[p][q]<0) continue;
            Li.push(g[i][j]);
            Lj.push(g[p][q]);
            Lv.push(-1);
        }
        Li.push(g[i][j]);
        Lj.push(g[i][j]);
        Lv.push(4);
    }
    return [Li,Lj,Lv];
}

numeric.cdotMV = function dotMV(A,x) {
    var ret, Ai = A[0], Aj = A[1], Av = A[2],k,p=Ai.length,N;
    N=0;
    for(k=0;k<p;k++) { if(Ai[k]>N) N = Ai[k]; }
    N++;
    ret = numeric.rep([N],0);
    for(k=0;k<p;k++) { ret[Ai[k]]+=Av[k]*x[Aj[k]]; }
    return ret;
}

// 7. Splines

numeric.Spline = function Spline(x,yl,yr,kl,kr) { this.x = x; this.yl = yl; this.yr = yr; this.kl = kl; this.kr = kr; }
numeric.Spline.prototype._at = function _at(x1,p) {
    var x = this.x;
    var yl = this.yl;
    var yr = this.yr;
    var kl = this.kl;
    var kr = this.kr;
    var x1,a,b,t;
    var add = numeric.add, sub = numeric.sub, mul = numeric.mul;
    a = sub(mul(kl[p],x[p+1]-x[p]),sub(yr[p+1],yl[p]));
    b = add(mul(kr[p+1],x[p]-x[p+1]),sub(yr[p+1],yl[p]));
    t = (x1-x[p])/(x[p+1]-x[p]);
    var s = t*(1-t);
    return add(add(add(mul(1-t,yl[p]),mul(t,yr[p+1])),mul(a,s*(1-t))),mul(b,s*t));
}
numeric.Spline.prototype.at = function at(x0) {
    if(typeof x0 === "number") {
        var x = this.x;
        var n = x.length;
        var p,q,mid,floor = Math.floor,a,b,t;
        p = 0;
        q = n-1;
        while(q-p>1) {
            mid = floor((p+q)/2);
            if(x[mid] <= x0) p = mid;
            else q = mid;
        }
        return this._at(x0,p);
    }
    var n = x0.length, i, ret = Array(n);
    for(i=n-1;i!==-1;--i) ret[i] = this.at(x0[i]);
    return ret;
}
numeric.Spline.prototype.diff = function diff() {
    var x = this.x;
    var yl = this.yl;
    var yr = this.yr;
    var kl = this.kl;
    var kr = this.kr;
    var n = yl.length;
    var i,dx,dy;
    var zl = kl, zr = kr, pl = Array(n), pr = Array(n);
    var add = numeric.add, mul = numeric.mul, div = numeric.div, sub = numeric.sub;
    for(i=n-1;i!==-1;--i) {
        dx = x[i+1]-x[i];
        dy = sub(yr[i+1],yl[i]);
        pl[i] = div(add(mul(dy, 6),mul(kl[i],-4*dx),mul(kr[i+1],-2*dx)),dx*dx);
        pr[i+1] = div(add(mul(dy,-6),mul(kl[i], 2*dx),mul(kr[i+1], 4*dx)),dx*dx);
    }
    return new numeric.Spline(x,zl,zr,pl,pr);
}
numeric.Spline.prototype.roots = function roots() {
    function sqr(x) { return x*x; }
    function heval(y0,y1,k0,k1,x) {
        var A = k0*2-(y1-y0);
        var B = -k1*2+(y1-y0);
        var t = (x+1)*0.5;
        var s = t*(1-t);
        return (1-t)*y0+t*y1+A*s*(1-t)+B*s*t;
    }
    var ret = [];
    var x = this.x, yl = this.yl, yr = this.yr, kl = this.kl, kr = this.kr;
    if(typeof yl[0] === "number") {
        yl = [yl];
        yr = [yr];
        kl = [kl];
        kr = [kr];
    }
    var m = yl.length,n=x.length-1,i,j,k,y,s,t;
    var ai,bi,ci,di, ret = Array(m),ri,k0,k1,y0,y1,A,B,D,dx,cx,stops,z0,z1,zm,t0,t1,tm;
    var sqrt = Math.sqrt;
    for(i=0;i!==m;++i) {
        ai = yl[i];
        bi = yr[i];
        ci = kl[i];
        di = kr[i];
        ri = [];
        for(j=0;j!==n;j++) {
            if(j>0 && bi[j]*ai[j]<0) ri.push(x[j]);
            dx = (x[j+1]-x[j]);
            cx = x[j];
            y0 = ai[j];
            y1 = bi[j+1];
            k0 = ci[j]/dx;
            k1 = di[j+1]/dx;
            D = sqr(k0-k1+3*(y0-y1)) + 12*k1*y0;
            A = k1+3*y0+2*k0-3*y1;
            B = 3*(k1+k0+2*(y0-y1));
            if(D<=0) {
                z0 = A/B;
                if(z0>x[j] && z0<x[j+1]) stops = [x[j],z0,x[j+1]];
                else stops = [x[j],x[j+1]];
            } else {
                z0 = (A-sqrt(D))/B;
                z1 = (A+sqrt(D))/B;
                stops = [x[j]];
                if(z0>x[j] && z0<x[j+1]) stops.push(z0);
                if(z1>x[j] && z1<x[j+1]) stops.push(z1);
                stops.push(x[j+1]);
            }
            t0 = stops[0];
            z0 = this._at(t0,j);
            for(k=0;k<stops.length-1;k++) {
                t1 = stops[k+1];
                z1 = this._at(t1,j);
                if(z0 === 0) {
                    ri.push(t0); 
                    t0 = t1;
                    z0 = z1;
                    continue;
                }
                if(z1 === 0 || z0*z1>0) {
                    t0 = t1;
                    z0 = z1;
                    continue;
                }
                var side = 0;
                while(1) {
                    tm = (z0*t1-z1*t0)/(z0-z1);
                    if(tm <= t0 || tm >= t1) { break; }
                    zm = this._at(tm,j);
                    if(zm*z1>0) {
                        t1 = tm;
                        z1 = zm;
                        if(side === -1) z0*=0.5;
                        side = -1;
                    } else if(zm*z0>0) {
                        t0 = tm;
                        z0 = zm;
                        if(side === 1) z1*=0.5;
                        side = 1;
                    } else break;
                }
                ri.push(tm);
                t0 = stops[k+1];
                z0 = this._at(t0, j);
            }
            if(z1 === 0) ri.push(t1);
        }
        ret[i] = ri;
    }
    if(typeof this.yl[0] === "number") return ret[0];
    return ret;
}
numeric.spline = function spline(x,y,k1,kn) {
    var n = x.length, b = [], dx = [], dy = [];
    var i;
    var sub = numeric.sub,mul = numeric.mul,add = numeric.add;
    for(i=n-2;i>=0;i--) { dx[i] = x[i+1]-x[i]; dy[i] = sub(y[i+1],y[i]); }
    if(typeof k1 === "string" || typeof kn === "string") { 
        k1 = kn = "periodic";
    }
    // Build sparse tridiagonal system
    var T = [[],[],[]];
    switch(typeof k1) {
    case "undefined":
        b[0] = mul(3/(dx[0]*dx[0]),dy[0]);
        T[0].push(0,0);
        T[1].push(0,1);
        T[2].push(2/dx[0],1/dx[0]);
        break;
    case "string":
        b[0] = add(mul(3/(dx[n-2]*dx[n-2]),dy[n-2]),mul(3/(dx[0]*dx[0]),dy[0]));
        T[0].push(0,0,0);
        T[1].push(n-2,0,1);
        T[2].push(1/dx[n-2],2/dx[n-2]+2/dx[0],1/dx[0]);
        break;
    default:
        b[0] = k1;
        T[0].push(0);
        T[1].push(0);
        T[2].push(1);
        break;
    }
    for(i=1;i<n-1;i++) {
        b[i] = add(mul(3/(dx[i-1]*dx[i-1]),dy[i-1]),mul(3/(dx[i]*dx[i]),dy[i]));
        T[0].push(i,i,i);
        T[1].push(i-1,i,i+1);
        T[2].push(1/dx[i-1],2/dx[i-1]+2/dx[i],1/dx[i]);
    }
    switch(typeof kn) {
    case "undefined":
        b[n-1] = mul(3/(dx[n-2]*dx[n-2]),dy[n-2]);
        T[0].push(n-1,n-1);
        T[1].push(n-2,n-1);
        T[2].push(1/dx[n-2],2/dx[n-2]);
        break;
    case "string":
        T[1][T[1].length-1] = 0;
        break;
    default:
        b[n-1] = kn;
        T[0].push(n-1);
        T[1].push(n-1);
        T[2].push(1);
        break;
    }
    if(typeof b[0] !== "number") b = numeric.transpose(b);
    else b = [b];
    var k = Array(b.length);
    if(typeof k1 === "string") {
        for(i=k.length-1;i!==-1;--i) {
            k[i] = numeric.ccsLUPSolve(numeric.ccsLUP(numeric.ccsScatter(T)),b[i]);
            k[i][n-1] = k[i][0];
        }
    } else {
        for(i=k.length-1;i!==-1;--i) {
            k[i] = numeric.cLUsolve(numeric.cLU(T),b[i]);
        }
    }
    if(typeof y[0] === "number") k = k[0];
    else k = numeric.transpose(k);
    return new numeric.Spline(x,y,y,k,k);
}

// 8. FFT
numeric.fftpow2 = function fftpow2(x,y) {
    var n = x.length;
    if(n === 1) return;
    var cos = Math.cos, sin = Math.sin, i,j;
    var xe = Array(n/2), ye = Array(n/2), xo = Array(n/2), yo = Array(n/2);
    j = n/2;
    for(i=n-1;i!==-1;--i) {
        --j;
        xo[j] = x[i];
        yo[j] = y[i];
        --i;
        xe[j] = x[i];
        ye[j] = y[i];
    }
    fftpow2(xe,ye);
    fftpow2(xo,yo);
    j = n/2;
    var t,k = (-6.2831853071795864769252867665590057683943387987502116419/n),ci,si;
    for(i=n-1;i!==-1;--i) {
        --j;
        if(j === -1) j = n/2-1;
        t = k*i;
        ci = cos(t);
        si = sin(t);
        x[i] = xe[j] + ci*xo[j] - si*yo[j];
        y[i] = ye[j] + ci*yo[j] + si*xo[j];
    }
}
numeric._ifftpow2 = function _ifftpow2(x,y) {
    var n = x.length;
    if(n === 1) return;
    var cos = Math.cos, sin = Math.sin, i,j;
    var xe = Array(n/2), ye = Array(n/2), xo = Array(n/2), yo = Array(n/2);
    j = n/2;
    for(i=n-1;i!==-1;--i) {
        --j;
        xo[j] = x[i];
        yo[j] = y[i];
        --i;
        xe[j] = x[i];
        ye[j] = y[i];
    }
    _ifftpow2(xe,ye);
    _ifftpow2(xo,yo);
    j = n/2;
    var t,k = (6.2831853071795864769252867665590057683943387987502116419/n),ci,si;
    for(i=n-1;i!==-1;--i) {
        --j;
        if(j === -1) j = n/2-1;
        t = k*i;
        ci = cos(t);
        si = sin(t);
        x[i] = xe[j] + ci*xo[j] - si*yo[j];
        y[i] = ye[j] + ci*yo[j] + si*xo[j];
    }
}
numeric.ifftpow2 = function ifftpow2(x,y) {
    numeric._ifftpow2(x,y);
    numeric.diveq(x,x.length);
    numeric.diveq(y,y.length);
}
numeric.convpow2 = function convpow2(ax,ay,bx,by) {
    numeric.fftpow2(ax,ay);
    numeric.fftpow2(bx,by);
    var i,n = ax.length,axi,bxi,ayi,byi;
    for(i=n-1;i!==-1;--i) {
        axi = ax[i]; ayi = ay[i]; bxi = bx[i]; byi = by[i];
        ax[i] = axi*bxi-ayi*byi;
        ay[i] = axi*byi+ayi*bxi;
    }
    numeric.ifftpow2(ax,ay);
}
numeric.T.prototype.fft = function fft() {
    var x = this.x, y = this.y;
    var n = x.length, log = Math.log, log2 = log(2),
        p = Math.ceil(log(2*n-1)/log2), m = Math.pow(2,p);
    var cx = numeric.rep([m],0), cy = numeric.rep([m],0), cos = Math.cos, sin = Math.sin;
    var k, c = (-3.141592653589793238462643383279502884197169399375105820/n),t;
    var a = numeric.rep([m],0), b = numeric.rep([m],0),nhalf = Math.floor(n/2);
    for(k=0;k<n;k++) a[k] = x[k];
    if(typeof y !== "undefined") for(k=0;k<n;k++) b[k] = y[k];
    cx[0] = 1;
    for(k=1;k<=m/2;k++) {
        t = c*k*k;
        cx[k] = cos(t);
        cy[k] = sin(t);
        cx[m-k] = cos(t);
        cy[m-k] = sin(t)
    }
    var X = new numeric.T(a,b), Y = new numeric.T(cx,cy);
    X = X.mul(Y);
    numeric.convpow2(X.x,X.y,numeric.clone(Y.x),numeric.neg(Y.y));
    X = X.mul(Y);
    X.x.length = n;
    X.y.length = n;
    return X;
}
numeric.T.prototype.ifft = function ifft() {
    var x = this.x, y = this.y;
    var n = x.length, log = Math.log, log2 = log(2),
        p = Math.ceil(log(2*n-1)/log2), m = Math.pow(2,p);
    var cx = numeric.rep([m],0), cy = numeric.rep([m],0), cos = Math.cos, sin = Math.sin;
    var k, c = (3.141592653589793238462643383279502884197169399375105820/n),t;
    var a = numeric.rep([m],0), b = numeric.rep([m],0),nhalf = Math.floor(n/2);
    for(k=0;k<n;k++) a[k] = x[k];
    if(typeof y !== "undefined") for(k=0;k<n;k++) b[k] = y[k];
    cx[0] = 1;
    for(k=1;k<=m/2;k++) {
        t = c*k*k;
        cx[k] = cos(t);
        cy[k] = sin(t);
        cx[m-k] = cos(t);
        cy[m-k] = sin(t)
    }
    var X = new numeric.T(a,b), Y = new numeric.T(cx,cy);
    X = X.mul(Y);
    numeric.convpow2(X.x,X.y,numeric.clone(Y.x),numeric.neg(Y.y));
    X = X.mul(Y);
    X.x.length = n;
    X.y.length = n;
    return X.div(n);
}

//9. Unconstrained optimization
numeric.gradient = function gradient(f,x) {
    var n = x.length;
    var f0 = f(x);
    if(isNaN(f0)) throw new Error('gradient: f(x) is a NaN!');
    var max = Math.max;
    var i,x0 = numeric.clone(x),f1,f2, J = Array(n);
    var div = numeric.div, sub = numeric.sub,errest,roundoff,max = Math.max,eps = 1e-3,abs = Math.abs, min = Math.min;
    var t0,t1,t2,it=0,d1,d2,N;
    for(i=0;i<n;i++) {
        var h = max(1e-6*f0,1e-8);
        while(1) {
            ++it;
            if(it>20) { throw new Error("Numerical gradient fails"); }
            x0[i] = x[i]+h;
            f1 = f(x0);
            x0[i] = x[i]-h;
            f2 = f(x0);
            x0[i] = x[i];
            if(isNaN(f1) || isNaN(f2)) { h/=16; continue; }
            J[i] = (f1-f2)/(2*h);
            t0 = x[i]-h;
            t1 = x[i];
            t2 = x[i]+h;
            d1 = (f1-f0)/h;
            d2 = (f0-f2)/h;
            N = max(abs(J[i]),abs(f0),abs(f1),abs(f2),abs(t0),abs(t1),abs(t2),1e-8);
            errest = min(max(abs(d1-J[i]),abs(d2-J[i]),abs(d1-d2))/N,h/N);
            if(errest>eps) { h/=16; }
            else break;
            }
    }
    return J;
}

numeric.uncmin = function uncmin(f,x0,tol,gradient,maxit,callback,options) {
    var grad = numeric.gradient;
    if(typeof options === "undefined") { options = {}; }
    if(typeof tol === "undefined") { tol = 1e-8; }
    if(typeof gradient === "undefined") { gradient = function(x) { return grad(f,x); }; }
    if(typeof maxit === "undefined") maxit = 1000;
    x0 = numeric.clone(x0);
    var n = x0.length;
    var f0 = f(x0),f1,df0;
    if(isNaN(f0)) throw new Error('uncmin: f(x0) is a NaN!');
    var max = Math.max, norm2 = numeric.norm2;
    tol = max(tol,numeric.epsilon);
    var step,g0,g1,H1 = options.Hinv || numeric.identity(n);
    var dot = numeric.dot, inv = numeric.inv, sub = numeric.sub, add = numeric.add, ten = numeric.tensor, div = numeric.div, mul = numeric.mul;
    var all = numeric.all, isfinite = numeric.isFinite, neg = numeric.neg;
    var it=0,i,s,x1,y,Hy,Hs,ys,i0,t,nstep,t1,t2;
    var msg = "";
    g0 = gradient(x0);
    while(it<maxit) {
        if(typeof callback === "function") { if(callback(it,x0,f0,g0,H1)) { msg = "Callback returned true"; break; } }
        if(!all(isfinite(g0))) { msg = "Gradient has Infinity or NaN"; break; }
        step = neg(dot(H1,g0));
        if(!all(isfinite(step))) { msg = "Search direction has Infinity or NaN"; break; }
        nstep = norm2(step);
        if(nstep < tol) { msg="Newton step smaller than tol"; break; }
        t = 1;
        df0 = dot(g0,step);
        // line search
        x1 = x0;
        while(it < maxit) {
            if(t*nstep < tol) { break; }
            s = mul(step,t);
            x1 = add(x0,s);
            f1 = f(x1);
            if(f1-f0 >= 0.1*t*df0 || isNaN(f1)) {
                t *= 0.5;
                ++it;
                continue;
            }
            break;
        }
        if(t*nstep < tol) { msg = "Line search step size smaller than tol"; break; }
        if(it === maxit) { msg = "maxit reached during line search"; break; }
        g1 = gradient(x1);
        y = sub(g1,g0);
        ys = dot(y,s);
        Hy = dot(H1,y);
        H1 = sub(add(H1,
                mul(
                        (ys+dot(y,Hy))/(ys*ys),
                        ten(s,s)    )),
                div(add(ten(Hy,s),ten(s,Hy)),ys));
        x0 = x1;
        f0 = f1;
        g0 = g1;
        ++it;
    }
    return {solution: x0, f: f0, gradient: g0, invHessian: H1, iterations:it, message: msg};
}

// 10. Ode solver (Dormand-Prince)
numeric.Dopri = function Dopri(x,y,f,ymid,iterations,msg,events) {
    this.x = x;
    this.y = y;
    this.f = f;
    this.ymid = ymid;
    this.iterations = iterations;
    this.events = events;
    this.message = msg;
}
numeric.Dopri.prototype._at = function _at(xi,j) {
    function sqr(x) { return x*x; }
    var sol = this;
    var xs = sol.x;
    var ys = sol.y;
    var k1 = sol.f;
    var ymid = sol.ymid;
    var n = xs.length;
    var x0,x1,xh,y0,y1,yh,xi;
    var floor = Math.floor,h;
    var c = 0.5;
    var add = numeric.add, mul = numeric.mul,sub = numeric.sub, p,q,w;
    x0 = xs[j];
    x1 = xs[j+1];
    y0 = ys[j];
    y1 = ys[j+1];
    h  = x1-x0;
    xh = x0+c*h;
    yh = ymid[j];
    p = sub(k1[j  ],mul(y0,1/(x0-xh)+2/(x0-x1)));
    q = sub(k1[j+1],mul(y1,1/(x1-xh)+2/(x1-x0)));
    w = [sqr(xi - x1) * (xi - xh) / sqr(x0 - x1) / (x0 - xh),
         sqr(xi - x0) * sqr(xi - x1) / sqr(x0 - xh) / sqr(x1 - xh),
         sqr(xi - x0) * (xi - xh) / sqr(x1 - x0) / (x1 - xh),
         (xi - x0) * sqr(xi - x1) * (xi - xh) / sqr(x0-x1) / (x0 - xh),
         (xi - x1) * sqr(xi - x0) * (xi - xh) / sqr(x0-x1) / (x1 - xh)];
    return add(add(add(add(mul(y0,w[0]),
                           mul(yh,w[1])),
                           mul(y1,w[2])),
                           mul( p,w[3])),
                           mul( q,w[4]));
}
numeric.Dopri.prototype.at = function at(x) {
    var i,j,k,floor = Math.floor;
    if(typeof x !== "number") {
        var n = x.length, ret = Array(n);
        for(i=n-1;i!==-1;--i) {
            ret[i] = this.at(x[i]);
        }
        return ret;
    }
    var x0 = this.x;
    i = 0; j = x0.length-1;
    while(j-i>1) {
        k = floor(0.5*(i+j));
        if(x0[k] <= x) i = k;
        else j = k;
    }
    return this._at(x,i);
}

numeric.dopri = function dopri(x0,x1,y0,f,tol,maxit,event) {
    if(typeof tol === "undefined") { tol = 1e-6; }
    if(typeof maxit === "undefined") { maxit = 1000; }
    var xs = [x0], ys = [y0], k1 = [f(x0,y0)], k2,k3,k4,k5,k6,k7, ymid = [];
    var A2 = 1/5;
    var A3 = [3/40,9/40];
    var A4 = [44/45,-56/15,32/9];
    var A5 = [19372/6561,-25360/2187,64448/6561,-212/729];
    var A6 = [9017/3168,-355/33,46732/5247,49/176,-5103/18656];
    var b = [35/384,0,500/1113,125/192,-2187/6784,11/84];
    var bm = [0.5*6025192743/30085553152,
              0,
              0.5*51252292925/65400821598,
              0.5*-2691868925/45128329728,
              0.5*187940372067/1594534317056,
              0.5*-1776094331/19743644256,
              0.5*11237099/235043384];
    var c = [1/5,3/10,4/5,8/9,1,1];
    var e = [-71/57600,0,71/16695,-71/1920,17253/339200,-22/525,1/40];
    var i = 0,er,j;
    var h = (x1-x0)/10;
    var it = 0;
    var add = numeric.add, mul = numeric.mul, y1,erinf;
    var max = Math.max, min = Math.min, abs = Math.abs, norminf = numeric.norminf,pow = Math.pow;
    var any = numeric.any, lt = numeric.lt, and = numeric.and, sub = numeric.sub;
    var e0, e1, ev;
    var ret = new numeric.Dopri(xs,ys,k1,ymid,-1,"");
    if(typeof event === "function") e0 = event(x0,y0);
    while(x0<x1 && it<maxit) {
        ++it;
        if(x0+h>x1) h = x1-x0;
        k2 = f(x0+c[0]*h,                add(y0,mul(   A2*h,k1[i])));
        k3 = f(x0+c[1]*h,            add(add(y0,mul(A3[0]*h,k1[i])),mul(A3[1]*h,k2)));
        k4 = f(x0+c[2]*h,        add(add(add(y0,mul(A4[0]*h,k1[i])),mul(A4[1]*h,k2)),mul(A4[2]*h,k3)));
        k5 = f(x0+c[3]*h,    add(add(add(add(y0,mul(A5[0]*h,k1[i])),mul(A5[1]*h,k2)),mul(A5[2]*h,k3)),mul(A5[3]*h,k4)));
        k6 = f(x0+c[4]*h,add(add(add(add(add(y0,mul(A6[0]*h,k1[i])),mul(A6[1]*h,k2)),mul(A6[2]*h,k3)),mul(A6[3]*h,k4)),mul(A6[4]*h,k5)));
        y1 = add(add(add(add(add(y0,mul(k1[i],h*b[0])),mul(k3,h*b[2])),mul(k4,h*b[3])),mul(k5,h*b[4])),mul(k6,h*b[5]));
        k7 = f(x0+h,y1);
        er = add(add(add(add(add(mul(k1[i],h*e[0]),mul(k3,h*e[2])),mul(k4,h*e[3])),mul(k5,h*e[4])),mul(k6,h*e[5])),mul(k7,h*e[6]));
        if(typeof er === "number") erinf = abs(er);
        else erinf = norminf(er);
        if(erinf > tol) { // reject
            h = 0.2*h*pow(tol/erinf,0.25);
            if(x0+h === x0) {
                ret.msg = "Step size became too small";
                break;
            }
            continue;
        }
        ymid[i] = add(add(add(add(add(add(y0,
                mul(k1[i],h*bm[0])),
                mul(k3   ,h*bm[2])),
                mul(k4   ,h*bm[3])),
                mul(k5   ,h*bm[4])),
                mul(k6   ,h*bm[5])),
                mul(k7   ,h*bm[6]));
        ++i;
        xs[i] = x0+h;
        ys[i] = y1;
        k1[i] = k7;
        if(typeof event === "function") {
            var yi,xl = x0,xr = x0+0.5*h,xi;
            e1 = event(xr,ymid[i-1]);
            ev = and(lt(e0,0),lt(0,e1));
            if(!any(ev)) { xl = xr; xr = x0+h; e0 = e1; e1 = event(xr,y1); ev = and(lt(e0,0),lt(0,e1)); }
            if(any(ev)) {
                var xc, yc, en,ei;
                var side=0, sl = 1.0, sr = 1.0;
                while(1) {
                    if(typeof e0 === "number") xi = (sr*e1*xl-sl*e0*xr)/(sr*e1-sl*e0);
                    else {
                        xi = xr;
                        for(j=e0.length-1;j!==-1;--j) {
                            if(e0[j]<0 && e1[j]>0) xi = min(xi,(sr*e1[j]*xl-sl*e0[j]*xr)/(sr*e1[j]-sl*e0[j]));
                        }
                    }
                    if(xi <= xl || xi >= xr) break;
                    yi = ret._at(xi, i-1);
                    ei = event(xi,yi);
                    en = and(lt(e0,0),lt(0,ei));
                    if(any(en)) {
                        xr = xi;
                        e1 = ei;
                        ev = en;
                        sr = 1.0;
                        if(side === -1) sl *= 0.5;
                        else sl = 1.0;
                        side = -1;
                    } else {
                        xl = xi;
                        e0 = ei;
                        sl = 1.0;
                        if(side === 1) sr *= 0.5;
                        else sr = 1.0;
                        side = 1;
                    }
                }
                y1 = ret._at(0.5*(x0+xi),i-1);
                ret.f[i] = f(xi,yi);
                ret.x[i] = xi;
                ret.y[i] = yi;
                ret.ymid[i-1] = y1;
                ret.events = ev;
                ret.iterations = it;
                return ret;
            }
        }
        x0 += h;
        y0 = y1;
        e0 = e1;
        h = min(0.8*h*pow(tol/erinf,0.25),4*h);
    }
    ret.iterations = it;
    return ret;
}

// 11. Ax = b
numeric.LU = function(A, fast) {
  fast = fast || false;

  var abs = Math.abs;
  var i, j, k, absAjk, Akk, Ak, Pk, Ai;
  var max;
  var n = A.length, n1 = n-1;
  var P = new Array(n);
  if(!fast) A = numeric.clone(A);

  for (k = 0; k < n; ++k) {
    Pk = k;
    Ak = A[k];
    max = abs(Ak[k]);
    for (j = k + 1; j < n; ++j) {
      absAjk = abs(A[j][k]);
      if (max < absAjk) {
        max = absAjk;
        Pk = j;
      }
    }
    P[k] = Pk;

    if (Pk != k) {
      A[k] = A[Pk];
      A[Pk] = Ak;
      Ak = A[k];
    }

    Akk = Ak[k];

    for (i = k + 1; i < n; ++i) {
      A[i][k] /= Akk;
    }

    for (i = k + 1; i < n; ++i) {
      Ai = A[i];
      for (j = k + 1; j < n1; ++j) {
        Ai[j] -= Ai[k] * Ak[j];
        ++j;
        Ai[j] -= Ai[k] * Ak[j];
      }
      if(j===n1) Ai[j] -= Ai[k] * Ak[j];
    }
  }

  return {
    LU: A,
    P:  P
  };
}

numeric.LUsolve = function LUsolve(LUP, b) {
  var i, j;
  var LU = LUP.LU;
  var n   = LU.length;
  var x = numeric.clone(b);
  var P   = LUP.P;
  var Pi, LUi, LUii, tmp;

  for (i=n-1;i!==-1;--i) x[i] = b[i];
  for (i = 0; i < n; ++i) {
    Pi = P[i];
    if (P[i] !== i) {
      tmp = x[i];
      x[i] = x[Pi];
      x[Pi] = tmp;
    }

    LUi = LU[i];
    for (j = 0; j < i; ++j) {
      x[i] -= x[j] * LUi[j];
    }
  }

  for (i = n - 1; i >= 0; --i) {
    LUi = LU[i];
    for (j = i + 1; j < n; ++j) {
      x[i] -= x[j] * LUi[j];
    }

    x[i] /= LUi[i];
  }

  return x;
}

numeric.solve = function solve(A,b,fast) { return numeric.LUsolve(numeric.LU(A,fast), b); }

// 12. Linear programming
numeric.echelonize = function echelonize(A) {
    var s = numeric.dim(A), m = s[0], n = s[1];
    var I = numeric.identity(m);
    var P = Array(m);
    var i,j,k,l,Ai,Ii,Z,a;
    var abs = Math.abs;
    var diveq = numeric.diveq;
    A = numeric.clone(A);
    for(i=0;i<m;++i) {
        k = 0;
        Ai = A[i];
        Ii = I[i];
        for(j=1;j<n;++j) if(abs(Ai[k])<abs(Ai[j])) k=j;
        P[i] = k;
        diveq(Ii,Ai[k]);
        diveq(Ai,Ai[k]);
        for(j=0;j<m;++j) if(j!==i) {
            Z = A[j]; a = Z[k];
            for(l=n-1;l!==-1;--l) Z[l] -= Ai[l]*a;
            Z = I[j];
            for(l=m-1;l!==-1;--l) Z[l] -= Ii[l]*a;
        }
    }
    return {I:I, A:A, P:P};
}

numeric.__solveLP = function __solveLP(c,A,b,tol,maxit,x,flag) {
    var sum = numeric.sum, log = numeric.log, mul = numeric.mul, sub = numeric.sub, dot = numeric.dot, div = numeric.div, add = numeric.add;
    var m = c.length, n = b.length,y;
    var unbounded = false, cb,i0=0;
    var alpha = 1.0;
    var f0,df0,AT = numeric.transpose(A), svd = numeric.svd,transpose = numeric.transpose,leq = numeric.leq, sqrt = Math.sqrt, abs = Math.abs;
    var muleq = numeric.muleq;
    var norm = numeric.norminf, any = numeric.any,min = Math.min;
    var all = numeric.all, gt = numeric.gt;
    var p = Array(m), A0 = Array(n),e=numeric.rep([n],1), H;
    var solve = numeric.solve, z = sub(b,dot(A,x)),count;
    var dotcc = dot(c,c);
    var g;
    for(count=i0;count<maxit;++count) {
        var i,j,d;
        for(i=n-1;i!==-1;--i) A0[i] = div(A[i],z[i]);
        var A1 = transpose(A0);
        for(i=m-1;i!==-1;--i) p[i] = (/*x[i]+*/sum(A1[i]));
        alpha = 0.25*abs(dotcc/dot(c,p));
        var a1 = 100*sqrt(dotcc/dot(p,p));
        if(!isFinite(alpha) || alpha>a1) alpha = a1;
        g = add(c,mul(alpha,p));
        H = dot(A1,A0);
        for(i=m-1;i!==-1;--i) H[i][i] += 1;
        d = solve(H,div(g,alpha),true);
        var t0 = div(z,dot(A,d));
        var t = 1.0;
        for(i=n-1;i!==-1;--i) if(t0[i]<0) t = min(t,-0.999*t0[i]);
        y = sub(x,mul(d,t));
        z = sub(b,dot(A,y));
        if(!all(gt(z,0))) return { solution: x, message: "", iterations: count };
        x = y;
        if(alpha<tol) return { solution: y, message: "", iterations: count };
        if(flag) {
            var s = dot(c,g), Ag = dot(A,g);
            unbounded = true;
            for(i=n-1;i!==-1;--i) if(s*Ag[i]<0) { unbounded = false; break; }
        } else {
            if(x[m-1]>=0) unbounded = false;
            else unbounded = true;
        }
        if(unbounded) return { solution: y, message: "Unbounded", iterations: count };
    }
    return { solution: x, message: "maximum iteration count exceeded", iterations:count };
}

numeric._solveLP = function _solveLP(c,A,b,tol,maxit) {
    var m = c.length, n = b.length,y;
    var sum = numeric.sum, log = numeric.log, mul = numeric.mul, sub = numeric.sub, dot = numeric.dot, div = numeric.div, add = numeric.add;
    var c0 = numeric.rep([m],0).concat([1]);
    var J = numeric.rep([n,1],-1);
    var A0 = numeric.blockMatrix([[A                   ,   J  ]]);
    var b0 = b;
    var y = numeric.rep([m],0).concat(Math.max(0,numeric.sup(numeric.neg(b)))+1);
    var x0 = numeric.__solveLP(c0,A0,b0,tol,maxit,y,false);
    var x = numeric.clone(x0.solution);
    x.length = m;
    var foo = numeric.inf(sub(b,dot(A,x)));
    if(foo<0) { return { solution: NaN, message: "Infeasible", iterations: x0.iterations }; }
    var ret = numeric.__solveLP(c, A, b, tol, maxit-x0.iterations, x, true);
    ret.iterations += x0.iterations;
    return ret;
};

numeric.solveLP = function solveLP(c,A,b,Aeq,beq,tol,maxit) {
    if(typeof maxit === "undefined") maxit = 1000;
    if(typeof tol === "undefined") tol = numeric.epsilon;
    if(typeof Aeq === "undefined") return numeric._solveLP(c,A,b,tol,maxit);
    var m = Aeq.length, n = Aeq[0].length, o = A.length;
    var B = numeric.echelonize(Aeq);
    var flags = numeric.rep([n],0);
    var P = B.P;
    var Q = [];
    var i;
    for(i=P.length-1;i!==-1;--i) flags[P[i]] = 1;
    for(i=n-1;i!==-1;--i) if(flags[i]===0) Q.push(i);
    var g = numeric.getRange;
    var I = numeric.linspace(0,m-1), J = numeric.linspace(0,o-1);
    var Aeq2 = g(Aeq,I,Q), A1 = g(A,J,P), A2 = g(A,J,Q), dot = numeric.dot, sub = numeric.sub;
    var A3 = dot(A1,B.I);
    var A4 = sub(A2,dot(A3,Aeq2)), b4 = sub(b,dot(A3,beq));
    var c1 = Array(P.length), c2 = Array(Q.length);
    for(i=P.length-1;i!==-1;--i) c1[i] = c[P[i]];
    for(i=Q.length-1;i!==-1;--i) c2[i] = c[Q[i]];
    var c4 = sub(c2,dot(c1,dot(B.I,Aeq2)));
    var S = numeric._solveLP(c4,A4,b4,tol,maxit);
    var x2 = S.solution;
    if(x2!==x2) return S;
    var x1 = dot(B.I,sub(beq,dot(Aeq2,x2)));
    var x = Array(c.length);
    for(i=P.length-1;i!==-1;--i) x[P[i]] = x1[i];
    for(i=Q.length-1;i!==-1;--i) x[Q[i]] = x2[i];
    return { solution: x, message:S.message, iterations: S.iterations };
}

numeric.MPStoLP = function MPStoLP(MPS) {
    if(MPS instanceof String) { MPS.split('\n'); }
    var state = 0;
    var states = ['Initial state','NAME','ROWS','COLUMNS','RHS','BOUNDS','ENDATA'];
    var n = MPS.length;
    var i,j,z,N=0,rows = {}, sign = [], rl = 0, vars = {}, nv = 0;
    var name;
    var c = [], A = [], b = [];
    function err(e) { throw new Error('MPStoLP: '+e+'\nLine '+i+': '+MPS[i]+'\nCurrent state: '+states[state]+'\n'); }
    for(i=0;i<n;++i) {
        z = MPS[i];
        var w0 = z.match(/\S*/g);
        var w = [];
        for(j=0;j<w0.length;++j) if(w0[j]!=="") w.push(w0[j]);
        if(w.length === 0) continue;
        for(j=0;j<states.length;++j) if(z.substr(0,states[j].length) === states[j]) break;
        if(j<states.length) {
            state = j;
            if(j===1) { name = w[1]; }
            if(j===6) return { name:name, c:c, A:numeric.transpose(A), b:b, rows:rows, vars:vars };
            continue;
        }
        switch(state) {
        case 0: case 1: err('Unexpected line');
        case 2: 
            switch(w[0]) {
            case 'N': if(N===0) N = w[1]; else err('Two or more N rows'); break;
            case 'L': rows[w[1]] = rl; sign[rl] = 1; b[rl] = 0; ++rl; break;
            case 'G': rows[w[1]] = rl; sign[rl] = -1;b[rl] = 0; ++rl; break;
            case 'E': rows[w[1]] = rl; sign[rl] = 0;b[rl] = 0; ++rl; break;
            default: err('Parse error '+numeric.prettyPrint(w));
            }
            break;
        case 3:
            if(!vars.hasOwnProperty(w[0])) { vars[w[0]] = nv; c[nv] = 0; A[nv] = numeric.rep([rl],0); ++nv; }
            var p = vars[w[0]];
            for(j=1;j<w.length;j+=2) {
                if(w[j] === N) { c[p] = parseFloat(w[j+1]); continue; }
                var q = rows[w[j]];
                A[p][q] = (sign[q]<0?-1:1)*parseFloat(w[j+1]);
            }
            break;
        case 4:
            for(j=1;j<w.length;j+=2) b[rows[w[j]]] = (sign[rows[w[j]]]<0?-1:1)*parseFloat(w[j+1]);
            break;
        case 5: /*FIXME*/ break;
        case 6: err('Internal error');
        }
    }
    err('Reached end of file without ENDATA');
}
// seedrandom.js version 2.0.
// Author: David Bau 4/2/2011
//
// Defines a method Math.seedrandom() that, when called, substitutes
// an explicitly seeded RC4-based algorithm for Math.random().  Also
// supports automatic seeding from local or network sources of entropy.
//
// Usage:
//
//   <script src=http://davidbau.com/encode/seedrandom-min.js></script>
//
//   Math.seedrandom('yipee'); Sets Math.random to a function that is
//                             initialized using the given explicit seed.
//
//   Math.seedrandom();        Sets Math.random to a function that is
//                             seeded using the current time, dom state,
//                             and other accumulated local entropy.
//                             The generated seed string is returned.
//
//   Math.seedrandom('yowza', true);
//                             Seeds using the given explicit seed mixed
//                             together with accumulated entropy.
//
//   <script src="http://bit.ly/srandom-512"></script>
//                             Seeds using physical random bits downloaded
//                             from random.org.
//
//   <script src="https://jsonlib.appspot.com/urandom?callback=Math.seedrandom">
//   </script>                 Seeds using urandom bits from call.jsonlib.com,
//                             which is faster than random.org.
//
// Examples:
//
//   Math.seedrandom("hello");            // Use "hello" as the seed.
//   document.write(Math.random());       // Always 0.5463663768140734
//   document.write(Math.random());       // Always 0.43973793770592234
//   var rng1 = Math.random;              // Remember the current prng.
//
//   var autoseed = Math.seedrandom();    // New prng with an automatic seed.
//   document.write(Math.random());       // Pretty much unpredictable.
//
//   Math.random = rng1;                  // Continue "hello" prng sequence.
//   document.write(Math.random());       // Always 0.554769432473455
//
//   Math.seedrandom(autoseed);           // Restart at the previous seed.
//   document.write(Math.random());       // Repeat the 'unpredictable' value.
//
// Notes:
//
// Each time seedrandom('arg') is called, entropy from the passed seed
// is accumulated in a pool to help generate future seeds for the
// zero-argument form of Math.seedrandom, so entropy can be injected over
// time by calling seedrandom with explicit data repeatedly.
//
// On speed - This javascript implementation of Math.random() is about
// 3-10x slower than the built-in Math.random() because it is not native
// code, but this is typically fast enough anyway.  Seeding is more expensive,
// especially if you use auto-seeding.  Some details (timings on Chrome 4):
//
// Our Math.random()            - avg less than 0.002 milliseconds per call
// seedrandom('explicit')       - avg less than 0.5 milliseconds per call
// seedrandom('explicit', true) - avg less than 2 milliseconds per call
// seedrandom()                 - avg about 38 milliseconds per call
//
// LICENSE (BSD):
//
// Copyright 2010 David Bau, all rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
// 
//   1. Redistributions of source code must retain the above copyright
//      notice, this list of conditions and the following disclaimer.
//
//   2. Redistributions in binary form must reproduce the above copyright
//      notice, this list of conditions and the following disclaimer in the
//      documentation and/or other materials provided with the distribution.
// 
//   3. Neither the name of this module nor the names of its contributors may
//      be used to endorse or promote products derived from this software
//      without specific prior written permission.
// 
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
/**
 * All code is in an anonymous closure to keep the global namespace clean.
 *
 * @param {number=} overflow 
 * @param {number=} startdenom
 */

// Patched by Seb so that seedrandom.js does not pollute the Math object.
// My tests suggest that doing Math.trouble = 1 makes Math lookups about 5%
// slower.
numeric.seedrandom = { pow:Math.pow, random:Math.random };

(function (pool, math, width, chunks, significance, overflow, startdenom) {


//
// seedrandom()
// This is the seedrandom function described above.
//
math['seedrandom'] = function seedrandom(seed, use_entropy) {
  var key = [];
  var arc4;

  // Flatten the seed string or build one from local entropy if needed.
  seed = mixkey(flatten(
    use_entropy ? [seed, pool] :
    arguments.length ? seed :
    [new Date().getTime(), pool, window], 3), key);

  // Use the seed to initialize an ARC4 generator.
  arc4 = new ARC4(key);

  // Mix the randomness into accumulated entropy.
  mixkey(arc4.S, pool);

  // Override Math.random

  // This function returns a random double in [0, 1) that contains
  // randomness in every bit of the mantissa of the IEEE 754 value.

  math['random'] = function random() {  // Closure to return a random double:
    var n = arc4.g(chunks);             // Start with a numerator n < 2 ^ 48
    var d = startdenom;                 //   and denominator d = 2 ^ 48.
    var x = 0;                          //   and no 'extra last byte'.
    while (n < significance) {          // Fill up all significant digits by
      n = (n + x) * width;              //   shifting numerator and
      d *= width;                       //   denominator and generating a
      x = arc4.g(1);                    //   new least-significant-byte.
    }
    while (n >= overflow) {             // To avoid rounding up, before adding
      n /= 2;                           //   last byte, shift everything
      d /= 2;                           //   right using integer math until
      x >>>= 1;                         //   we have exactly the desired bits.
    }
    return (n + x) / d;                 // Form the number within [0, 1).
  };

  // Return the seed that was used
  return seed;
};

//
// ARC4
//
// An ARC4 implementation.  The constructor takes a key in the form of
// an array of at most (width) integers that should be 0 <= x < (width).
//
// The g(count) method returns a pseudorandom integer that concatenates
// the next (count) outputs from ARC4.  Its return value is a number x
// that is in the range 0 <= x < (width ^ count).
//
/** @constructor */
function ARC4(key) {
  var t, u, me = this, keylen = key.length;
  var i = 0, j = me.i = me.j = me.m = 0;
  me.S = [];
  me.c = [];

  // The empty key [] is treated as [0].
  if (!keylen) { key = [keylen++]; }

  // Set up S using the standard key scheduling algorithm.
  while (i < width) { me.S[i] = i++; }
  for (i = 0; i < width; i++) {
    t = me.S[i];
    j = lowbits(j + t + key[i % keylen]);
    u = me.S[j];
    me.S[i] = u;
    me.S[j] = t;
  }

  // The "g" method returns the next (count) outputs as one number.
  me.g = function getnext(count) {
    var s = me.S;
    var i = lowbits(me.i + 1); var t = s[i];
    var j = lowbits(me.j + t); var u = s[j];
    s[i] = u;
    s[j] = t;
    var r = s[lowbits(t + u)];
    while (--count) {
      i = lowbits(i + 1); t = s[i];
      j = lowbits(j + t); u = s[j];
      s[i] = u;
      s[j] = t;
      r = r * width + s[lowbits(t + u)];
    }
    me.i = i;
    me.j = j;
    return r;
  };
  // For robust unpredictability discard an initial batch of values.
  // See http://www.rsa.com/rsalabs/node.asp?id=2009
  me.g(width);
}

//
// flatten()
// Converts an object tree to nested arrays of strings.
//
/** @param {Object=} result 
  * @param {string=} prop
  * @param {string=} typ */
function flatten(obj, depth, result, prop, typ) {
  result = [];
  typ = typeof(obj);
  if (depth && typ == 'object') {
    for (prop in obj) {
      if (prop.indexOf('S') < 5) {    // Avoid FF3 bug (local/sessionStorage)
        try { result.push(flatten(obj[prop], depth - 1)); } catch (e) {}
      }
    }
  }
  return (result.length ? result : obj + (typ != 'string' ? '\0' : ''));
}

//
// mixkey()
// Mixes a string seed into a key that is an array of integers, and
// returns a shortened string seed that is equivalent to the result key.
//
/** @param {number=} smear 
  * @param {number=} j */
function mixkey(seed, key, smear, j) {
  seed += '';                         // Ensure the seed is a string
  smear = 0;
  for (j = 0; j < seed.length; j++) {
    key[lowbits(j)] =
      lowbits((smear ^= key[lowbits(j)] * 19) + seed.charCodeAt(j));
  }
  seed = '';
  for (j in key) { seed += String.fromCharCode(key[j]); }
  return seed;
}

//
// lowbits()
// A quick "n mod width" for width a power of 2.
//
function lowbits(n) { return n & (width - 1); }

//
// The following constants are related to IEEE 754 limits.
//
startdenom = math.pow(width, chunks);
significance = math.pow(2, significance);
overflow = significance * 2;

//
// When seedrandom.js is loaded, we immediately mix a few bits
// from the built-in RNG into the entropy pool.  Because we do
// not want to intefere with determinstic PRNG state later,
// seedrandom will not call math.random on its own again after
// initialization.
//
mixkey(math.random(), pool);

// End anonymous scope, and pass initial values.
}(
  [],   // pool: entropy pool starts empty
  numeric.seedrandom, // math: package containing random, pow, and seedrandom
  256,  // width: each RC4 output is 0 <= x < 256
  6,    // chunks: at least six RC4 outputs for each double
  52    // significance: there are 52 significant digits in a double
  ));
/* This file is a slightly modified version of quadprog.js from Alberto Santini.
 * It has been slightly modified by Sébastien Loisel to make sure that it handles
 * 0-based Arrays instead of 1-based Arrays.
 * License is in resources/LICENSE.quadprog */
(function(exports) {

function base0to1(A) {
    if(typeof A !== "object") { return A; }
    var ret = [], i,n=A.length;
    for(i=0;i<n;i++) ret[i+1] = base0to1(A[i]);
    return ret;
}
function base1to0(A) {
    if(typeof A !== "object") { return A; }
    var ret = [], i,n=A.length;
    for(i=1;i<n;i++) ret[i-1] = base1to0(A[i]);
    return ret;
}

function dpori(a, lda, n) {
    var i, j, k, kp1, t;

    for (k = 1; k <= n; k = k + 1) {
        a[k][k] = 1 / a[k][k];
        t = -a[k][k];
        //~ dscal(k - 1, t, a[1][k], 1);
        for (i = 1; i < k; i = i + 1) {
            a[i][k] = t * a[i][k];
        }

        kp1 = k + 1;
        if (n < kp1) {
            break;
        }
        for (j = kp1; j <= n; j = j + 1) {
            t = a[k][j];
            a[k][j] = 0;
            //~ daxpy(k, t, a[1][k], 1, a[1][j], 1);
            for (i = 1; i <= k; i = i + 1) {
                a[i][j] = a[i][j] + (t * a[i][k]);
            }
        }
    }

}

function dposl(a, lda, n, b) {
    var i, k, kb, t;

    for (k = 1; k <= n; k = k + 1) {
        //~ t = ddot(k - 1, a[1][k], 1, b[1], 1);
        t = 0;
        for (i = 1; i < k; i = i + 1) {
            t = t + (a[i][k] * b[i]);
        }

        b[k] = (b[k] - t) / a[k][k];
    }

    for (kb = 1; kb <= n; kb = kb + 1) {
        k = n + 1 - kb;
        b[k] = b[k] / a[k][k];
        t = -b[k];
        //~ daxpy(k - 1, t, a[1][k], 1, b[1], 1);
        for (i = 1; i < k; i = i + 1) {
            b[i] = b[i] + (t * a[i][k]);
        }
    }
}

function dpofa(a, lda, n, info) {
    var i, j, jm1, k, t, s;

    for (j = 1; j <= n; j = j + 1) {
        info[1] = j;
        s = 0;
        jm1 = j - 1;
        if (jm1 < 1) {
            s = a[j][j] - s;
            if (s <= 0) {
                break;
            }
            a[j][j] = Math.sqrt(s);
        } else {
            for (k = 1; k <= jm1; k = k + 1) {
                //~ t = a[k][j] - ddot(k - 1, a[1][k], 1, a[1][j], 1);
                t = a[k][j];
                for (i = 1; i < k; i = i + 1) {
                    t = t - (a[i][j] * a[i][k]);
                }
                t = t / a[k][k];
                a[k][j] = t;
                s = s + t * t;
            }
            s = a[j][j] - s;
            if (s <= 0) {
                break;
            }
            a[j][j] = Math.sqrt(s);
        }
        info[1] = 0;
    }
}

function qpgen2(dmat, dvec, fddmat, n, sol, crval, amat,
    bvec, fdamat, q, meq, iact, nact, iter, work, ierr) {

    var i, j, l, l1, info, it1, iwzv, iwrv, iwrm, iwsv, iwuv, nvl, r, iwnbv,
        temp, sum, t1, tt, gc, gs, nu,
        t1inf, t2min,
        vsmall, tmpa, tmpb,
        go;

    r = Math.min(n, q);
    l = 2 * n + (r * (r + 5)) / 2 + 2 * q + 1;

    vsmall = 1.0e-60;
    do {
        vsmall = vsmall + vsmall;
        tmpa = 1 + 0.1 * vsmall;
        tmpb = 1 + 0.2 * vsmall;
    } while (tmpa <= 1 || tmpb <= 1);

    for (i = 1; i <= n; i = i + 1) {
        work[i] = dvec[i];
    }
    for (i = n + 1; i <= l; i = i + 1) {
        work[i] = 0;
    }
    for (i = 1; i <= q; i = i + 1) {
        iact[i] = 0;
    }

    info = [];

    if (ierr[1] === 0) {
        dpofa(dmat, fddmat, n, info);
        if (info[1] !== 0) {
            ierr[1] = 2;
            return;
        }
        dposl(dmat, fddmat, n, dvec);
        dpori(dmat, fddmat, n);
    } else {
        for (j = 1; j <= n; j = j + 1) {
            sol[j] = 0;
            for (i = 1; i <= j; i = i + 1) {
                sol[j] = sol[j] + dmat[i][j] * dvec[i];
            }
        }
        for (j = 1; j <= n; j = j + 1) {
            dvec[j] = 0;
            for (i = j; i <= n; i = i + 1) {
                dvec[j] = dvec[j] + dmat[j][i] * sol[i];
            }
        }
    }

    crval[1] = 0;
    for (j = 1; j <= n; j = j + 1) {
        sol[j] = dvec[j];
        crval[1] = crval[1] + work[j] * sol[j];
        work[j] = 0;
        for (i = j + 1; i <= n; i = i + 1) {
            dmat[i][j] = 0;
        }
    }
    crval[1] = -crval[1] / 2;
    ierr[1] = 0;

    iwzv = n;
    iwrv = iwzv + n;
    iwuv = iwrv + r;
    iwrm = iwuv + r + 1;
    iwsv = iwrm + (r * (r + 1)) / 2;
    iwnbv = iwsv + q;

    for (i = 1; i <= q; i = i + 1) {
        sum = 0;
        for (j = 1; j <= n; j = j + 1) {
            sum = sum + amat[j][i] * amat[j][i];
        }
        work[iwnbv + i] = Math.sqrt(sum);
    }
    nact = 0;
    iter[1] = 0;
    iter[2] = 0;

    function fn_goto_50() {
        iter[1] = iter[1] + 1;

        l = iwsv;
        for (i = 1; i <= q; i = i + 1) {
            l = l + 1;
            sum = -bvec[i];
            for (j = 1; j <= n; j = j + 1) {
                sum = sum + amat[j][i] * sol[j];
            }
            if (Math.abs(sum) < vsmall) {
                sum = 0;
            }
            if (i > meq) {
                work[l] = sum;
            } else {
                work[l] = -Math.abs(sum);
                if (sum > 0) {
                    for (j = 1; j <= n; j = j + 1) {
                        amat[j][i] = -amat[j][i];
                    }
                    bvec[i] = -bvec[i];
                }
            }
        }

        for (i = 1; i <= nact; i = i + 1) {
            work[iwsv + iact[i]] = 0;
        }

        nvl = 0;
        temp = 0;
        for (i = 1; i <= q; i = i + 1) {
            if (work[iwsv + i] < temp * work[iwnbv + i]) {
                nvl = i;
                temp = work[iwsv + i] / work[iwnbv + i];
            }
        }
        if (nvl === 0) {
            return 999;
        }

        return 0;
    }

    function fn_goto_55() {
        for (i = 1; i <= n; i = i + 1) {
            sum = 0;
            for (j = 1; j <= n; j = j + 1) {
                sum = sum + dmat[j][i] * amat[j][nvl];
            }
            work[i] = sum;
        }

        l1 = iwzv;
        for (i = 1; i <= n; i = i + 1) {
            work[l1 + i] = 0;
        }
        for (j = nact + 1; j <= n; j = j + 1) {
            for (i = 1; i <= n; i = i + 1) {
                work[l1 + i] = work[l1 + i] + dmat[i][j] * work[j];
            }
        }

        t1inf = true;
        for (i = nact; i >= 1; i = i - 1) {
            sum = work[i];
            l = iwrm + (i * (i + 3)) / 2;
            l1 = l - i;
            for (j = i + 1; j <= nact; j = j + 1) {
                sum = sum - work[l] * work[iwrv + j];
                l = l + j;
            }
            sum = sum / work[l1];
            work[iwrv + i] = sum;
            if (iact[i] < meq) {
                // continue;
                break;
            }
            if (sum < 0) {
                // continue;
                break;
            }
            t1inf = false;
            it1 = i;
        }

        if (!t1inf) {
            t1 = work[iwuv + it1] / work[iwrv + it1];
            for (i = 1; i <= nact; i = i + 1) {
                if (iact[i] < meq) {
                    // continue;
                    break;
                }
                if (work[iwrv + i] < 0) {
                    // continue;
                    break;
                }
                temp = work[iwuv + i] / work[iwrv + i];
                if (temp < t1) {
                    t1 = temp;
                    it1 = i;
                }
            }
        }

        sum = 0;
        for (i = iwzv + 1; i <= iwzv + n; i = i + 1) {
            sum = sum + work[i] * work[i];
        }
        if (Math.abs(sum) <= vsmall) {
            if (t1inf) {
                ierr[1] = 1;
                // GOTO 999
                return 999;
            } else {
                for (i = 1; i <= nact; i = i + 1) {
                    work[iwuv + i] = work[iwuv + i] - t1 * work[iwrv + i];
                }
                work[iwuv + nact + 1] = work[iwuv + nact + 1] + t1;
                // GOTO 700
                return 700;
            }
        } else {
            sum = 0;
            for (i = 1; i <= n; i = i + 1) {
                sum = sum + work[iwzv + i] * amat[i][nvl];
            }
            tt = -work[iwsv + nvl] / sum;
            t2min = true;
            if (!t1inf) {
                if (t1 < tt) {
                    tt = t1;
                    t2min = false;
                }
            }

            for (i = 1; i <= n; i = i + 1) {
                sol[i] = sol[i] + tt * work[iwzv + i];
                if (Math.abs(sol[i]) < vsmall) {
                    sol[i] = 0;
                }
            }

            crval[1] = crval[1] + tt * sum * (tt / 2 + work[iwuv + nact + 1]);
            for (i = 1; i <= nact; i = i + 1) {
                work[iwuv + i] = work[iwuv + i] - tt * work[iwrv + i];
            }
            work[iwuv + nact + 1] = work[iwuv + nact + 1] + tt;

            if (t2min) {
                nact = nact + 1;
                iact[nact] = nvl;

                l = iwrm + ((nact - 1) * nact) / 2 + 1;
                for (i = 1; i <= nact - 1; i = i + 1) {
                    work[l] = work[i];
                    l = l + 1;
                }

                if (nact === n) {
                    work[l] = work[n];
                } else {
                    for (i = n; i >= nact + 1; i = i - 1) {
                        if (work[i] === 0) {
                            // continue;
                            break;
                        }
                        gc = Math.max(Math.abs(work[i - 1]), Math.abs(work[i]));
                        gs = Math.min(Math.abs(work[i - 1]), Math.abs(work[i]));
                        if (work[i - 1] >= 0) {
                            temp = Math.abs(gc * Math.sqrt(1 + gs * gs / (gc * gc)));
                        } else {
                            temp = -Math.abs(gc * Math.sqrt(1 + gs * gs / (gc * gc)));
                        }
                        gc = work[i - 1] / temp;
                        gs = work[i] / temp;

                        if (gc === 1) {
                            // continue;
                            break;
                        }
                        if (gc === 0) {
                            work[i - 1] = gs * temp;
                            for (j = 1; j <= n; j = j + 1) {
                                temp = dmat[j][i - 1];
                                dmat[j][i - 1] = dmat[j][i];
                                dmat[j][i] = temp;
                            }
                        } else {
                            work[i - 1] = temp;
                            nu = gs / (1 + gc);
                            for (j = 1; j <= n; j = j + 1) {
                                temp = gc * dmat[j][i - 1] + gs * dmat[j][i];
                                dmat[j][i] = nu * (dmat[j][i - 1] + temp) - dmat[j][i];
                                dmat[j][i - 1] = temp;

                            }
                        }
                    }
                    work[l] = work[nact];
                }
            } else {
                sum = -bvec[nvl];
                for (j = 1; j <= n; j = j + 1) {
                    sum = sum + sol[j] * amat[j][nvl];
                }
                if (nvl > meq) {
                    work[iwsv + nvl] = sum;
                } else {
                    work[iwsv + nvl] = -Math.abs(sum);
                    if (sum > 0) {
                        for (j = 1; j <= n; j = j + 1) {
                            amat[j][nvl] = -amat[j][nvl];
                        }
                        bvec[nvl] = -bvec[nvl];
                    }
                }
                // GOTO 700
                return 700;
            }
        }

        return 0;
    }

    function fn_goto_797() {
        l = iwrm + (it1 * (it1 + 1)) / 2 + 1;
        l1 = l + it1;
        if (work[l1] === 0) {
            // GOTO 798
            return 798;
        }
        gc = Math.max(Math.abs(work[l1 - 1]), Math.abs(work[l1]));
        gs = Math.min(Math.abs(work[l1 - 1]), Math.abs(work[l1]));
        if (work[l1 - 1] >= 0) {
            temp = Math.abs(gc * Math.sqrt(1 + gs * gs / (gc * gc)));
        } else {
            temp = -Math.abs(gc * Math.sqrt(1 + gs * gs / (gc * gc)));
        }
        gc = work[l1 - 1] / temp;
        gs = work[l1] / temp;

        if (gc === 1) {
            // GOTO 798
            return 798;
        }
        if (gc === 0) {
            for (i = it1 + 1; i <= nact; i = i + 1) {
                temp = work[l1 - 1];
                work[l1 - 1] = work[l1];
                work[l1] = temp;
                l1 = l1 + i;
            }
            for (i = 1; i <= n; i = i + 1) {
                temp = dmat[i][it1];
                dmat[i][it1] = dmat[i][it1 + 1];
                dmat[i][it1 + 1] = temp;
            }
        } else {
            nu = gs / (1 + gc);
            for (i = it1 + 1; i <= nact; i = i + 1) {
                temp = gc * work[l1 - 1] + gs * work[l1];
                work[l1] = nu * (work[l1 - 1] + temp) - work[l1];
                work[l1 - 1] = temp;
                l1 = l1 + i;
            }
            for (i = 1; i <= n; i = i + 1) {
                temp = gc * dmat[i][it1] + gs * dmat[i][it1 + 1];
                dmat[i][it1 + 1] = nu * (dmat[i][it1] + temp) - dmat[i][it1 + 1];
                dmat[i][it1] = temp;
            }
        }

        return 0;
    }

    function fn_goto_798() {
        l1 = l - it1;
        for (i = 1; i <= it1; i = i + 1) {
            work[l1] = work[l];
            l = l + 1;
            l1 = l1 + 1;
        }

        work[iwuv + it1] = work[iwuv + it1 + 1];
        iact[it1] = iact[it1 + 1];
        it1 = it1 + 1;
        if (it1 < nact) {
            // GOTO 797
            return 797;
        }

        return 0;
    }

    function fn_goto_799() {
        work[iwuv + nact] = work[iwuv + nact + 1];
        work[iwuv + nact + 1] = 0;
        iact[nact] = 0;
        nact = nact - 1;
        iter[2] = iter[2] + 1;

        return 0;
    }

    go = 0;
    while (true) {
        go = fn_goto_50();
        if (go === 999) {
            return;
        }
        while (true) {
            go = fn_goto_55();
            if (go === 0) {
                break;
            }
            if (go === 999) {
                return;
            }
            if (go === 700) {
                if (it1 === nact) {
                    fn_goto_799();
                } else {
                    while (true) {
                        fn_goto_797();
                        go = fn_goto_798();
                        if (go !== 797) {
                            break;
                        }
                    }
                    fn_goto_799();
                }
            }
        }
    }

}

function solveQP(Dmat, dvec, Amat, bvec, meq, factorized) {
    Dmat = base0to1(Dmat);
    dvec = base0to1(dvec);
    Amat = base0to1(Amat);
    var i, n, q,
        nact, r,
        crval = [], iact = [], sol = [], work = [], iter = [],
        message;

    meq = meq || 0;
    factorized = factorized ? base0to1(factorized) : [undefined, 0];
    bvec = bvec ? base0to1(bvec) : [];

    // In Fortran the array index starts from 1
    n = Dmat.length - 1;
    q = Amat[1].length - 1;

    if (!bvec) {
        for (i = 1; i <= q; i = i + 1) {
            bvec[i] = 0;
        }
    }
    for (i = 1; i <= q; i = i + 1) {
        iact[i] = 0;
    }
    nact = 0;
    r = Math.min(n, q);
    for (i = 1; i <= n; i = i + 1) {
        sol[i] = 0;
    }
    crval[1] = 0;
    for (i = 1; i <= (2 * n + (r * (r + 5)) / 2 + 2 * q + 1); i = i + 1) {
        work[i] = 0;
    }
    for (i = 1; i <= 2; i = i + 1) {
        iter[i] = 0;
    }

    qpgen2(Dmat, dvec, n, n, sol, crval, Amat,
        bvec, n, q, meq, iact, nact, iter, work, factorized);

    message = "";
    if (factorized[1] === 1) {
        message = "constraints are inconsistent, no solution!";
    }
    if (factorized[1] === 2) {
        message = "matrix D in quadratic function is not positive definite!";
    }

    return {
        solution: base1to0(sol),
        value: base1to0(crval),
        unconstrained_solution: base1to0(dvec),
        iterations: base1to0(iter),
        iact: base1to0(iact),
        message: message
    };
}
exports.solveQP = solveQP;
}(numeric));
/*
Shanti Rao sent me this routine by private email. I had to modify it
slightly to work on Arrays instead of using a Matrix object.
It is apparently translated from http://stitchpanorama.sourceforge.net/Python/svd.py
*/

numeric.svd= function svd(A) {
    var temp;
//Compute the thin SVD from G. H. Golub and C. Reinsch, Numer. Math. 14, 403-420 (1970)
	var prec= numeric.epsilon; //Math.pow(2,-52) // assumes double prec
	var tolerance= 1.e-64/prec;
	var itmax= 50;
	var c=0;
	var i=0;
	var j=0;
	var k=0;
	var l=0;
	
	var u= numeric.clone(A);
	var m= u.length;
	
	var n= u[0].length;
	
	if (m < n) throw "Need more rows than columns"
	
	var e = new Array(n);
	var q = new Array(n);
	for (i=0; i<n; i++) e[i] = q[i] = 0.0;
	var v = numeric.rep([n,n],0);
//	v.zero();
	
 	function pythag(a,b)
 	{
		a = Math.abs(a)
		b = Math.abs(b)
		if (a > b)
			return a*Math.sqrt(1.0+(b*b/a/a))
		else if (b == 0.0) 
			return a
		return b*Math.sqrt(1.0+(a*a/b/b))
	}

	//Householder's reduction to bidiagonal form

	var f= 0.0;
	var g= 0.0;
	var h= 0.0;
	var x= 0.0;
	var y= 0.0;
	var z= 0.0;
	var s= 0.0;
	
	for (i=0; i < n; i++)
	{	
		e[i]= g;
		s= 0.0;
		l= i+1;
		for (j=i; j < m; j++) 
			s += (u[j][i]*u[j][i]);
		if (s <= tolerance)
			g= 0.0;
		else
		{	
			f= u[i][i];
			g= Math.sqrt(s);
			if (f >= 0.0) g= -g;
			h= f*g-s
			u[i][i]=f-g;
			for (j=l; j < n; j++)
			{
				s= 0.0
				for (k=i; k < m; k++) 
					s += u[k][i]*u[k][j]
				f= s/h
				for (k=i; k < m; k++) 
					u[k][j]+=f*u[k][i]
			}
		}
		q[i]= g
		s= 0.0
		for (j=l; j < n; j++) 
			s= s + u[i][j]*u[i][j]
		if (s <= tolerance)
			g= 0.0
		else
		{	
			f= u[i][i+1]
			g= Math.sqrt(s)
			if (f >= 0.0) g= -g
			h= f*g - s
			u[i][i+1] = f-g;
			for (j=l; j < n; j++) e[j]= u[i][j]/h
			for (j=l; j < m; j++)
			{	
				s=0.0
				for (k=l; k < n; k++) 
					s += (u[j][k]*u[i][k])
				for (k=l; k < n; k++) 
					u[j][k]+=s*e[k]
			}	
		}
		y= Math.abs(q[i])+Math.abs(e[i])
		if (y>x) 
			x=y
	}
	
	// accumulation of right hand gtransformations
	for (i=n-1; i != -1; i+= -1)
	{	
		if (g != 0.0)
		{
		 	h= g*u[i][i+1]
			for (j=l; j < n; j++) 
				v[j][i]=u[i][j]/h
			for (j=l; j < n; j++)
			{	
				s=0.0
				for (k=l; k < n; k++) 
					s += u[i][k]*v[k][j]
				for (k=l; k < n; k++) 
					v[k][j]+=(s*v[k][i])
			}	
		}
		for (j=l; j < n; j++)
		{
			v[i][j] = 0;
			v[j][i] = 0;
		}
		v[i][i] = 1;
		g= e[i]
		l= i
	}
	
	// accumulation of left hand transformations
	for (i=n-1; i != -1; i+= -1)
	{	
		l= i+1
		g= q[i]
		for (j=l; j < n; j++) 
			u[i][j] = 0;
		if (g != 0.0)
		{
			h= u[i][i]*g
			for (j=l; j < n; j++)
			{
				s=0.0
				for (k=l; k < m; k++) s += u[k][i]*u[k][j];
				f= s/h
				for (k=i; k < m; k++) u[k][j]+=f*u[k][i];
			}
			for (j=i; j < m; j++) u[j][i] = u[j][i]/g;
		}
		else
			for (j=i; j < m; j++) u[j][i] = 0;
		u[i][i] += 1;
	}
	
	// diagonalization of the bidiagonal form
	prec= prec*x
	for (k=n-1; k != -1; k+= -1)
	{
		for (var iteration=0; iteration < itmax; iteration++)
		{	// test f splitting
			var test_convergence = false
			for (l=k; l != -1; l+= -1)
			{	
				if (Math.abs(e[l]) <= prec)
				{	test_convergence= true
					break 
				}
				if (Math.abs(q[l-1]) <= prec)
					break 
			}
			if (!test_convergence)
			{	// cancellation of e[l] if l>0
				c= 0.0
				s= 1.0
				var l1= l-1
				for (i =l; i<k+1; i++)
				{	
					f= s*e[i]
					e[i]= c*e[i]
					if (Math.abs(f) <= prec)
						break
					g= q[i]
					h= pythag(f,g)
					q[i]= h
					c= g/h
					s= -f/h
					for (j=0; j < m; j++)
					{	
						y= u[j][l1]
						z= u[j][i]
						u[j][l1] =  y*c+(z*s)
						u[j][i] = -y*s+(z*c)
					} 
				}	
			}
			// test f convergence
			z= q[k]
			if (l== k)
			{	//convergence
				if (z<0.0)
				{	//q[k] is made non-negative
					q[k]= -z
					for (j=0; j < n; j++)
						v[j][k] = -v[j][k]
				}
				break  //break out of iteration loop and move on to next k value
			}
			if (iteration >= itmax-1)
				throw 'Error: no convergence.'
			// shift from bottom 2x2 minor
			x= q[l]
			y= q[k-1]
			g= e[k-1]
			h= e[k]
			f= ((y-z)*(y+z)+(g-h)*(g+h))/(2.0*h*y)
			g= pythag(f,1.0)
			if (f < 0.0)
				f= ((x-z)*(x+z)+h*(y/(f-g)-h))/x
			else
				f= ((x-z)*(x+z)+h*(y/(f+g)-h))/x
			// next QR transformation
			c= 1.0
			s= 1.0
			for (i=l+1; i< k+1; i++)
			{	
				g= e[i]
				y= q[i]
				h= s*g
				g= c*g
				z= pythag(f,h)
				e[i-1]= z
				c= f/z
				s= h/z
				f= x*c+g*s
				g= -x*s+g*c
				h= y*s
				y= y*c
				for (j=0; j < n; j++)
				{	
					x= v[j][i-1]
					z= v[j][i]
					v[j][i-1] = x*c+z*s
					v[j][i] = -x*s+z*c
				}
				z= pythag(f,h)
				q[i-1]= z
				c= f/z
				s= h/z
				f= c*g+s*y
				x= -s*g+c*y
				for (j=0; j < m; j++)
				{
					y= u[j][i-1]
					z= u[j][i]
					u[j][i-1] = y*c+z*s
					u[j][i] = -y*s+z*c
				}
			}
			e[l]= 0.0
			e[k]= f
			q[k]= x
		} 
	}
		
	//vt= transpose(v)
	//return (u,q,vt)
	for (i=0;i<q.length; i++) 
	  if (q[i] < prec) q[i] = 0
	  
	//sort eigenvalues	
	for (i=0; i< n; i++)
	{	 
	//writeln(q)
	 for (j=i-1; j >= 0; j--)
	 {
	  if (q[j] < q[i])
	  {
	//  writeln(i,'-',j)
	   c = q[j]
	   q[j] = q[i]
	   q[i] = c
	   for(k=0;k<u.length;k++) { temp = u[k][i]; u[k][i] = u[k][j]; u[k][j] = temp; }
	   for(k=0;k<v.length;k++) { temp = v[k][i]; v[k][i] = v[k][j]; v[k][j] = temp; }
//	   u.swapCols(i,j)
//	   v.swapCols(i,j)
	   i = j	   
	  }
	 }	
	}
	
	return {U:u,S:q,V:v}
};


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],18:[function(require,module,exports){
/*
Simple Javascript undo and redo.
https://github.com/ArthurClemens/Javascript-Undo-Manager
*/

;(function() {

	'use strict';

    function removeFromTo(array, from, to) {
        array.splice(from,
            !to ||
            1 + to - from + (!(to < 0 ^ from >= 0) && (to < 0 || -1) * array.length));
        return array.length;
    }

    var UndoManager = function() {

        var commands = [],
            index = -1,
            limit = 0,
            isExecuting = false,
            callback,

            // functions
            execute;

        execute = function(command, action) {
            if (!command || typeof command[action] !== "function") {
                return this;
            }
            isExecuting = true;

            command[action]();

            isExecuting = false;
            return this;
        };

        return {

            /*
            Add a command to the queue.
            */
            add: function (command) {
                if (isExecuting) {
                    return this;
                }
                // if we are here after having called undo,
                // invalidate items higher on the stack
                commands.splice(index + 1, commands.length - index);

                commands.push(command);

                // if limit is set, remove items from the start
                if (limit && commands.length > limit) {
                    removeFromTo(commands, 0, -(limit+1));
                }

                // set the current index to the end
                index = commands.length - 1;
                if (callback) {
                    callback();
                }
                return this;
            },

            /*
            Pass a function to be called on undo and redo actions.
            */
            setCallback: function (callbackFunc) {
                callback = callbackFunc;
            },

            /*
            Perform undo: call the undo function at the current index and decrease the index by 1.
            */
            undo: function () {
                var command = commands[index];
                if (!command) {
                    return this;
                }
                execute(command, "undo");
                index -= 1;
                if (callback) {
                    callback();
                }
                return this;
            },

            /*
            Perform redo: call the redo function at the next index and increase the index by 1.
            */
            redo: function () {
                var command = commands[index + 1];
                if (!command) {
                    return this;
                }
                execute(command, "redo");
                index += 1;
                if (callback) {
                    callback();
                }
                return this;
            },

            /*
            Clears the memory, losing all stored states. Reset the index.
            */
            clear: function () {
                var prev_size = commands.length;

                commands = [];
                index = -1;

                if (callback && (prev_size > 0)) {
                    callback();
                }
            },

            hasUndo: function () {
                return index !== -1;
            },

            hasRedo: function () {
                return index < (commands.length - 1);
            },

            getCommands: function () {
                return commands;
            },

            getIndex: function() {
                return index;
            },

            setLimit: function (l) {
                limit = l;
            }
        };
    };

    if (typeof module !== 'undefined' && module.exports) {
		module.exports = UndoManager;
	} else if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
		// AMD. Register as an anonymous module.
		define(function() {
			return UndoManager;
		});
	} else {
		window.UndoManager = UndoManager;
	}

}());

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvaW5kZXguanMiLCJsaWIvcHJvZmlsZS9tb3Rpb25Qcm9maWxlLmpzIiwibGliL3Byb2ZpbGUvcHJvZmlsZUhlbHBlci5qcyIsImxpYi9zZWdtZW50cy9hY2NlbFNlZ21lbnQuanMiLCJsaWIvc2VnbWVudHMvYmFzaWNTZWdtZW50LmpzIiwibGliL3NlZ21lbnRzL2NhbVNlZ21lbnQuanMiLCJsaWIvc2VnbWVudHMvaW5kZXhTZWdtZW50LmpzIiwibGliL3NlZ21lbnRzL2xvYWRTZWdtZW50LmpzIiwibGliL3NlZ21lbnRzL21vdGlvblNlZ21lbnQuanMiLCJsaWIvc2VnbWVudHMvc2VnbWVudC5qcyIsImxpYi9zZWdtZW50cy9zZWdtZW50U3Rhc2guanMiLCJsaWIvdXRpbC9mYXN0TWF0aC5qcyIsImxpYi91dGlsL2xpbmtlZExpc3QuanMiLCJsaWIvdXRpbC9wb2x5bm9taWFsLmpzIiwibGliL3V0aWwvdW5kb01hbmFnZXIuanMiLCJsaWIvdXRpbC91dGlsLmpzIiwibm9kZV9tb2R1bGVzL251bWVyaWMvbnVtZXJpYy0xLjIuNi5qcyIsIm5vZGVfbW9kdWxlcy91bmRvLW1hbmFnZXIvbGliL3VuZG9tYW5hZ2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2bkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9mQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDamlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN6Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDeDBJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9wcm9maWxlL21vdGlvblByb2ZpbGUuanMnKTsiLCIvKipcbiAqIENyZWF0ZXMgTW90aW9uUHJvZmlsZS4gTW90aW9uUHJvZmlsZSBpcyBhIGxpc3Qgb2YgTW90aW9uU2VnbWVudHMuXG4gKiBNb3Rpb25TZWdtZW50cyByZXByZXNlbnQgdGhlIHZhcmlvdXMgYXZhaWxhYmxlIHNlZ21lbnRzIGluIGEgcHJvZmlsZSwgc3VjaCBhcyBCYXNpY1NlZ21lbnQsIEFjY2VsU2VnbWVudCxcbiAqIENhbVNlZ21lbnQsIEluZGV4U2VnbWVudCwgZXRjLi4uXG4gKlxuICovXG52YXIgQWNjZWxTZWdtZW50ID0gcmVxdWlyZSgnLi4vc2VnbWVudHMvYWNjZWxTZWdtZW50Jyk7XG52YXIgSW5kZXhTZWdtZW50ID0gcmVxdWlyZSgnLi4vc2VnbWVudHMvaW5kZXhTZWdtZW50Jyk7XG52YXIgTG9hZFNlZ21lbnQgPSByZXF1aXJlKCcuLi9zZWdtZW50cy9sb2FkU2VnbWVudCcpO1xudmFyIENhbVNlZ21lbnQ9IHJlcXVpcmUoJy4uL3NlZ21lbnRzL2NhbVNlZ21lbnQnKTtcbnZhciBNb3Rpb25TZWdtZW50ID0gcmVxdWlyZSgnLi4vc2VnbWVudHMvbW90aW9uU2VnbWVudCcpO1xudmFyIFNlZ21lbnRTdGFzaCA9IHJlcXVpcmUoJy4uL3NlZ21lbnRzL3NlZ21lbnRTdGFzaCcpO1xudmFyIGZhc3RNYXRoID0gcmVxdWlyZSgnLi4vdXRpbC9mYXN0TWF0aCcpO1xudmFyIHByb2ZpbGVIZWxwZXIgPSByZXF1aXJlKCcuL3Byb2ZpbGVIZWxwZXInKTtcbnZhciB1bmRvTWFuYWdlciA9IHJlcXVpcmUoJy4uL3V0aWwvdW5kb01hbmFnZXInKTtcbnZhciBVdGlsID0gcmVxdWlyZSgnLi4vdXRpbC91dGlsJyk7XG5cbi8qKlxuICogTU9USU9OIFBST0ZJTEUgT0JKRUNUIExPR0lDXG4gKi9cblxudmFyIE1vdGlvblByb2ZpbGUgPSBmdW5jdGlvbih0eXBlKSB7XG5cdC8vIHJvdGFyeSBpcyB0cmVhdGVkIGFzIGRlZmF1bHRcblx0dGhpcy50eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpID09PSBcInJvdGFyeVwiID8gXCJyb3RhcnlcIiA6IFwibGluZWFyXCI7XG5cdHRoaXMuaW5pdGlhbFBvc2l0aW9uID0gMDtcblx0dGhpcy5pbml0aWFsVmVsb2NpdHkgPSAwO1xuXHR0aGlzLmluaXRpYWxUaHJ1c3QgPSAwO1xuXHR0aGlzLmluaXRpYWxMb2FkID0gMDtcblx0dGhpcy5pbml0aWFsRnJpY3Rpb24gPSAwO1xuXG5cdC8vY3JlYXRlIG9iamVjdCB0byBob2xkIGFsbCB0aGUgcHJvZmlsZSBsb2Fkc1xuXHR2YXIgbG9hZHMgPSB7fTtcblxuXHRpZiAodGhpcy50eXBlID09PSBcInJvdGFyeVwiKSB7XG5cdFx0T2JqZWN0LmtleXMoTG9hZFNlZ21lbnQuUm90YXJ5TG9hZHNFbnVtKS5mb3JFYWNoKGZ1bmN0aW9uKGxvYWQpIHtcblx0XHRcdGxvYWRzW2xvYWRdID0gU2VnbWVudFN0YXNoLm1ha2VTdGFzaCgpO1xuXHRcdH0pO1xuXHR9IGVsc2Uge1xuXHRcdE9iamVjdC5rZXlzKExvYWRTZWdtZW50LkxpbmVhckxvYWRzRW51bSkuZm9yRWFjaChmdW5jdGlvbihsb2FkKSB7XG5cdFx0XHRsb2Fkc1tsb2FkXSA9IFNlZ21lbnRTdGFzaC5tYWtlU3Rhc2goKTtcblx0XHR9KTtcblx0fVxuXG5cdHRoaXMucHJvZmlsZUxvYWRzID0gbG9hZHM7XG5cdHRoaXMudW5kb01hbmFnZXIgPSB1bmRvTWFuYWdlcjtcblxuXHRNb3Rpb25TZWdtZW50Lk1vdGlvblNlZ21lbnQuY2FsbCh0aGlzKTtcbn07XG5cblxuTW90aW9uUHJvZmlsZS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudC5wcm90b3R5cGUpO1xuTW90aW9uUHJvZmlsZS5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBNb3Rpb25Qcm9maWxlO1xuXG5cbi8qKlxuICogU2V0IHRoZSBpbml0aWFsIHBvc2l0aW9uIGFuZCB2ZWxvY2l0eSBmb3IgdGhpcyBtb3Rpb24gcHJvZmlsZVxuICogQHBhcmFtIHtOdW1iZXJ9IHBvc2l0aW9uIHBvc2l0aW9uIGluIFtyYWRdIG9yIFttXVxuICogQHBhcmFtIHtOdW1iZXJ9IHZlbG9jaXR5IHZlbG9jaXR5IGluIFtyYWQvc10gb3IgW20vc11cbiAqL1xuTW90aW9uUHJvZmlsZS5wcm90b3R5cGUuc2V0SW5pdGlhbENvbmRpdGlvbnMgPSBmdW5jdGlvbihwb3NpdGlvbiwgdmVsb2NpdHksIGxvYWQsIHRocnVzdCwgZnJpY3Rpb24pIHtcblx0dGhpcy5pbml0aWFsUG9zaXRpb24gPSBwb3NpdGlvbjtcblx0dGhpcy5pbml0aWFsVmVsb2NpdHkgPSB2ZWxvY2l0eTtcblxuXHR0aGlzLmluaXRpYWxUaHJ1c3QgPSB0aHJ1c3Q7XG5cdHRoaXMuaW5pdGlhbExvYWQgPSBsb2FkO1xuXHR0aGlzLmluaXRpYWxGcmljdGlvbiA9IGZyaWN0aW9uO1xuXG5cblx0Ly9hZnRlciBzZXR0aW5nIGluaXRpYWwgY29uZGl0aW9ucywgYWxsIHN1YnNlcXVlbnQgbW9kdWxlcyBtdXN0IGJlIHJlY2FsY3VsYXRlZFxuXHR2YXIgY3VycmVudCA9IHRoaXMuc2VnbWVudHMuZmlyc3RTZWdtZW50KCk7XG5cblx0dGhpcy5yZWNhbGN1bGF0ZVByb2ZpbGVTZWdtZW50cyhjdXJyZW50KTtcbn07XG5cblxuLyoqXG4gKiBHZXRzIGFsbCBiYXNpYyBzZWdtZW50cyB0aGF0IGV4aXN0IGluIHRoZSBwcm9maWxlLiBCYXNpYyBTZWdtZW50cyBhcmUgdGhlIG1vc3QgYmFzaWMgYnVpbGRpbmcgYmxvY2tzXG4gKi9cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmdldEFsbEJhc2ljU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcblx0dmFyIGFsbFNlZ21lbnRzID0gW107XG5cdC8vIHVzaW5nIGFzc29jaWF0aXZlIGFycmF5IHRvIGhvbGQgYWxsIHNlZ21lbnRzIC0+IHF1aWNrIGFuZCBlYXN5IHRvIHNlYXJjaFxuXHR0aGlzLnNlZ21lbnRzLmdldEFsbFNlZ21lbnRzKCkuZm9yRWFjaChmdW5jdGlvbihlbGVtZW50KSB7XG5cdFx0YWxsU2VnbWVudHMucHVzaChlbGVtZW50LmdldEFsbFNlZ21lbnRzKCkpO1xuXHR9KTtcblxuXHQvLyBwcmV2aW91cyBjb2RlIGdldHMgdXMgYW4gYXJyYXkgb2YgYXJyYXlzLCB3ZSBuZWVkIHRvIGZsYXR0ZW4gaXRcblx0cmV0dXJuIGFsbFNlZ21lbnRzLnJlZHVjZShmdW5jdGlvbihhLCBiKSB7XG5cdFx0cmV0dXJuIGEuY29uY2F0KGIpO1xuXHR9KTtcbn07XG5cbi8qKlxuICogUmVjYWxjdWxhdGVzIG1vdGlvbiBwcm9maWxlIHNlZ21lbnRzIGR1ZSB0byBhIGNoYW5nZS4gU3RhcnRzIHJlY2FsY3VsYXRpbmcgYXQgcGFzc2VkLWluIHNlZ21lbnRcbiAqIEBwYXJhbSAge01vdGlvblNlZ21lbnR9IGN1cnJlbnQgc2VnbWVudCB0byBzdGFydCByZWNhbGN1bGF0aW9uc1xuICovXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5yZWNhbGN1bGF0ZVByb2ZpbGVTZWdtZW50cyA9IGZ1bmN0aW9uKGN1cnJlbnQpIHtcblx0Ly9ub3RoaW5nIHRvIGRvXG5cdGlmICghY3VycmVudClcblx0XHRyZXR1cm47XG5cblx0aWYgKCEoY3VycmVudCBpbnN0YW5jZW9mIE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudCkpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3RpbmcgYSBNb3Rpb25TZWdtZW50IHR5cGUnKTtcblxuXHR2YXIgcHJldiwgcHJldmlvdXNWYWx1ZXM7XG5cdHdoaWxlIChjdXJyZW50KSB7XG5cdFx0cHJldiA9IHRoaXMuc2VnbWVudHMuZ2V0UHJldmlvdXNTZWdtZW50KGN1cnJlbnQuaWQpO1xuXG5cdFx0Ly9oYW5kbGUgZmlyc3Qgc2VnbWVudFxuXHRcdGlmICghcHJldikge1xuXHRcdFx0cHJldmlvdXNWYWx1ZXMgPSBbMCwgMCwgdGhpcy5pbml0aWFsVmVsb2NpdHksIHRoaXMuaW5pdGlhbFBvc2l0aW9uXTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0cHJldmlvdXNWYWx1ZXMgPSBwcmV2LmdldEZpbmFsVmFsdWVzKCk7XG5cdFx0fVxuXG5cdFx0Y3VycmVudC5tb2RpZnlJbml0aWFsVmFsdWVzKHByZXZpb3VzVmFsdWVzWzBdLCBwcmV2aW91c1ZhbHVlc1sxXSwgcHJldmlvdXNWYWx1ZXNbMl0sIHByZXZpb3VzVmFsdWVzWzNdKTtcblxuXHRcdC8vbW92ZSBuZXh0XG5cdFx0Y3VycmVudCA9IHRoaXMuc2VnbWVudHMuZ2V0TmV4dFNlZ21lbnQoY3VycmVudC5pZCk7XG5cdH1cbn07XG5cblxuTW90aW9uUHJvZmlsZS5wcm90b3R5cGUuZ2V0QWxsU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcblx0cmV0dXJuIHRoaXMuc2VnbWVudHMuZ2V0QWxsU2VnbWVudHMoKTtcbn07XG5cblxuLyoqXG4gKiBDaGVja3MgYW5kIHJldHVybnMgaWYgZXhpc3RzIGFuIGV4aXN0aW5nIHNlZ21lbnQgYmVnaW5uaW5nIGF0IHRpbWUgaW5pdGlhbFRpbWVcbiAqIEBwYXJhbSB7bnVtYmVyfSBpbml0aWFsVGltZSBpbml0aWFsIHRpbWUgb2Ygc2VnbWVudCB0byBjaGVja1xuICogQHJldHVybnMge01vdGlvblNlZ21lbnR9IGV4aXN0aW5nIHNlZ21lbnQgb3IgbnVsbCBpZiBub25lIGZvdW5kXG4gKi9cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmdldEV4aXN0aW5nU2VnbWVudCA9IGZ1bmN0aW9uKGluaXRpYWxUaW1lKSB7XG5cdHJldHVybiB0aGlzLnNlZ21lbnRzLmZpbmRTZWdtZW50V2l0aEluaXRpYWxUaW1lKGluaXRpYWxUaW1lKTtcbn07XG5cblxuLyoqXG4gKiBJbnNlcnRzIG9yIGFwcGVuZHMgYSBzZWdtZW50IGludG8gdGhlIG1vdGlvbiBwcm9maWxlXG4gKiBAcGFyYW0ge01vdGlvblNlZ21lbnR9IHNlZ21lbnQgU2VnbWVudCB0byBpbnNlcnQgaW50byB0aGUgcHJvZmlsZVxuICovXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5pbnNlcnRTZWdtZW50ID0gZnVuY3Rpb24oc2VnbWVudCwgc2VnbWVudElkKSB7XG5cblx0aWYgKCEoc2VnbWVudCBpbnN0YW5jZW9mIE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudCkpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdBdHRlbXB0aW5nIHRvIGluc2VydCBhbiBvYmplY3Qgd2hpY2ggaXMgbm90IGEgTW90aW9uU2VnbWVudCcpO1xuXG5cdC8vbmVlZCB0byBnZXQgZmluYWwgdmFsdWVzIG9mIHByZXZpb3VzIHNlZ21lbnRcblx0dmFyIHByZXYgPSB0aGlzLnNlZ21lbnRzLmdldFByZXZpb3VzU2VnbWVudChzZWdtZW50SWQpO1xuXG5cdHZhciBsYXN0VmFsdWVzO1xuXG5cdGlmIChwcmV2ICE9PSBudWxsKSB7XG5cdFx0Ly9tb2RpZnkgdGhlIHNlZ21lbnQgYmVpbmcgaW5zZXJ0ZWQgdG8gbWFrZSBzdXJlIGluaXRpYWwgdmFsdWVzID09IHByZXZpb3VzIHNlZ21lbnQncyBmaW5hbCB2YWx1ZXNcblx0XHRsYXN0VmFsdWVzID0gcHJldi5nZXRGaW5hbFZhbHVlcygpO1xuXHR9IGVsc2Uge1xuXHRcdGxhc3RWYWx1ZXMgPSBbMCwgMCwgdGhpcy5pbml0aWFsVmVsb2NpdHksIHRoaXMuaW5pdGlhbFBvc2l0aW9uXTtcblx0fVxuXG5cdHNlZ21lbnQubW9kaWZ5SW5pdGlhbFZhbHVlcyhsYXN0VmFsdWVzWzBdLCBsYXN0VmFsdWVzWzFdLCBsYXN0VmFsdWVzWzJdLCBsYXN0VmFsdWVzWzNdKTtcblxuXHR2YXIgbmV3U2VnbWVudCA9IHRoaXMuc2VnbWVudHMuaW5zZXJ0QXQoc2VnbWVudCwgc2VnbWVudElkKTtcblx0aWYgKCFuZXdTZWdtZW50KVxuXHRcdHRocm93IG5ldyBFcnJvcihcImluc2VydGluZyBhIHNlZ21lbnQgZmFpbGVkXCIpO1xuXG5cdC8vYWZ0ZXIgaW5zZXJ0aW5nIGEgc2VnbWVudCwgYWxsIHN1YnNlcXVlbnQgc2VnbWVudHMgbXVzdCBiZSByZWNhbGN1bGF0ZWRcblx0dmFyIGN1cnJlbnQgPSB0aGlzLnNlZ21lbnRzLmdldE5leHRTZWdtZW50KG5ld1NlZ21lbnQuaWQpO1xuXHR0aGlzLnJlY2FsY3VsYXRlUHJvZmlsZVNlZ21lbnRzKGN1cnJlbnQpO1xuXG5cdHZhciBwcm9maWxlID0gdGhpcztcblxuXHQvLyB1bmRvIC9yZWRvIGZ1bmN0aW9uYWxpdHlcblx0dGhpcy51bmRvTWFuYWdlci5hZGQoe1xuXHRcdHVuZG86IGZ1bmN0aW9uKCkge1xuXHRcdFx0cHJvZmlsZS5kZWxldGVTZWdtZW50KG5ld1NlZ21lbnQuaWQpO1xuXHRcdH0sXG5cdFx0cmVkbzogZnVuY3Rpb24oKSB7XG5cdFx0XHRwcm9maWxlLmluc2VydFNlZ21lbnQoc2VnbWVudCwgc2VnbWVudElkKTtcblx0XHR9XG5cdH0pO1xuXG5cdHJldHVybiBzZWdtZW50O1xufTtcblxuXG4vKipcbiAqIEFwcGVuZCBzZWdtZW50IGF0IHRoZSBlbmQgb2YgdGhlIGN1cnJlbnQgcHJvZmlsZVxuICogQHBhcmFtICB7W3R5cGVdfSBzZWdtZW50IFtkZXNjcmlwdGlvbl1cbiAqIEByZXR1cm4ge1t0eXBlXX0gICAgICAgICBbZGVzY3JpcHRpb25dXG4gKi9cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmFwcGVuZFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50KSB7XG5cdGlmICghKHNlZ21lbnQgaW5zdGFuY2VvZiBNb3Rpb25TZWdtZW50Lk1vdGlvblNlZ21lbnQpKVxuXHRcdHRocm93IG5ldyBFcnJvcignQXR0ZW1wdGluZyB0byBpbnNlcnQgYW4gb2JqZWN0IHdoaWNoIGlzIG5vdCBhIE1vdGlvblNlZ21lbnQnKTtcblxuXHQvLyBldmVuIHRob3VnaCB3ZSBhcHBlbmQgYXQgdGhlIGVuZCwgc3RpbGwgaGF2ZSB0byBtYWtlIHN1cmUgdGhhdCBpbml0aWFsL2ZpbmFsIGNvbmRpdGlvbnMgYXJlIHNhdGlzZmllZFxuXHR2YXIgbGFzdFNlZ21lbnQgPSB0aGlzLnNlZ21lbnRzLmxhc3RTZWdtZW50KCk7XG5cdGlmIChsYXN0U2VnbWVudCkge1xuXHRcdHZhciBsYXN0VmFsdWVzID0gbGFzdFNlZ21lbnQuZ2V0RmluYWxWYWx1ZXMoKTtcblx0XHRzZWdtZW50Lm1vZGlmeUluaXRpYWxWYWx1ZXMobGFzdFZhbHVlc1swXSwgbGFzdFZhbHVlc1sxXSwgbGFzdFZhbHVlc1syXSwgbGFzdFZhbHVlc1szXSk7XG5cdH1cblxuXHR0aGlzLnNlZ21lbnRzLmluc2VydEF0KHNlZ21lbnQsIG51bGwpO1xuXG5cdHZhciBwcm9maWxlID0gdGhpcztcblxuXHQvLyB1bmRvL3JlZG8gZnVuY3Rpb25hbGl0eVxuXHR0aGlzLnVuZG9NYW5hZ2VyLmFkZCh7XG5cdFx0dW5kbzogZnVuY3Rpb24oKSB7XG5cdFx0XHRwcm9maWxlLmRlbGV0ZVNlZ21lbnQoc2VnbWVudC5pZCk7XG5cdFx0fSxcblx0XHRyZWRvOiBmdW5jdGlvbigpIHtcblx0XHRcdHByb2ZpbGUuYXBwZW5kU2VnbWVudChzZWdtZW50KTtcblx0XHR9XG5cdH0pO1xuXG5cdHJldHVybiBzZWdtZW50O1xufTtcblxuXG4vKipcbiAqIERlbGV0ZXMgc3BlY2lmaWVkIHNlZ21lbnQuIFN1cHBvc2Ugd2UgaGF2ZSBzZWdtZW50cyAxLCAyIGFuZCAzIGFuZCB3YW50IHRvIGRlbGV0ZSAyLlxuICogXHRGaXJzdCwgd2UgZGVsZXRlIHNlZ21lbnQgMi4gVGhlbiwgd2UgbW9kaWZ5IHRoZSBpbml0aWFsIHZhbHVlcyBvZiBzZWdtZW50IDMgdG8gYmUgdGhlIGZpbmFsIHZhbHVlcyBvZiBzZWdtZW50IDFcbiAqIEBwYXJhbSB7TW90aW9uU2VnbWVudH0gc2VnbWVudElkIGlkZW50aWZ5IHNlZ21lbnQgdG8gZGVsZXRlXG4gKi9cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmRlbGV0ZVNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50SWQpIHtcblxuXHRpZiAoIWZhc3RNYXRoLmlzTnVtZXJpYyhzZWdtZW50SWQpIHx8IGZhc3RNYXRoLmx0KHNlZ21lbnRJZCwgMCkpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3Qgc2VnbWVudElkIHRvIGJlIGEgcG9zaXRpdmUgaW50ZWdlcicpO1xuXG5cdHZhciBwcmV2aW91cyA9IHRoaXMuc2VnbWVudHMuZ2V0UHJldmlvdXNTZWdtZW50KHNlZ21lbnRJZCk7XG5cdHZhciBjdXJyZW50ID0gdGhpcy5zZWdtZW50cy5nZXROZXh0U2VnbWVudChzZWdtZW50SWQpO1xuXG5cdHZhciBzZWdUb0RlbGV0ZSA9IHRoaXMuc2VnbWVudHMuZGVsZXRlKHNlZ21lbnRJZCk7XG5cdGlmICghc2VnVG9EZWxldGUpXG5cdFx0dGhyb3cgbmV3IEVycm9yKFwiVW5hYmxlIHRvIGRlbGV0ZSBzZWdtZW50IHdpdGggaWQgXCIgKyBzZWdtZW50SWQpO1xuXG5cdHZhciBjdXJyZW50SWQ9bnVsbDtcblx0aWYoY3VycmVudClcblx0XHRjdXJyZW50SWQ9Y3VycmVudC5pZDtcblxuXHQvL3VuZG8gLyByZWRvXG5cdHZhciBwcm9maWxlID0gdGhpcztcblx0dGhpcy51bmRvTWFuYWdlci5hZGQoe1xuXHRcdHVuZG86IGZ1bmN0aW9uKCkge1xuXHRcdFx0cHJvZmlsZS5pbnNlcnRTZWdtZW50KHNlZ1RvRGVsZXRlLCBjdXJyZW50SWQpO1xuXHRcdH0sXG5cdFx0cmVkbzogZnVuY3Rpb24oKSB7XG5cdFx0XHRwcm9maWxlLmRlbGV0ZVNlZ21lbnQoc2VnbWVudElkKTtcblx0XHR9XG5cdH0pO1xuXG5cblx0Ly9jb3VsZCBiZSB0aGUgb25seSBzZWdtZW50XG5cdGlmICh0aGlzLnNlZ21lbnRzLmNvdW50U2VnbWVudHMoKSA9PT0gMClcblx0XHRyZXR1cm4gc2VnVG9EZWxldGU7XG5cblx0dGhpcy5yZWNhbGN1bGF0ZVByb2ZpbGVTZWdtZW50cyhjdXJyZW50KTtcblxuXG5cblx0cmV0dXJuIHNlZ1RvRGVsZXRlO1xufTtcblxuXG4vKipcbiAqIFJlbW92ZXMgYWxsIHByb2ZpbGUgc2VnbWVudHNcbiAqL1xuTW90aW9uUHJvZmlsZS5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcblxuXHQvL25lZWQgdG8gc2F2ZSBhbGwgc2VnbWVudHNcblxuXG5cdHZhciB0aGF0ID0gdGhpcztcblx0dGhpcy5nZXRBbGxTZWdtZW50cygpLmZvckVhY2goZnVuY3Rpb24oc2VnKSB7XG5cdFx0dmFyIHNlZ1RvRGVsZXRlID0gdGhhdC5zZWdtZW50cy5kZWxldGUoc2VnLmlkKTtcblx0fSk7XG59O1xuXG5cbi8qKlxuICogRmluZHMgcGFyZW50IHNlZ21lbnQgYnkgY2hpbGQgc2VnbWVudCBpZC4gRWcuIHBhc3MgYSBiYXNpYyBzZWdtZW50IGlkLCBnZXQgYmFjayBpdHMgYWNjZWwgc2VnbWVudFxuICogQHBhcmFtICB7aW50fSBzZWdtZW50SWQgc2VnbWVudCBpZFxuICogQHJldHVybiB7TW90aW9uU2VnbWVudH0gICAgICAgICAgIHBhcmVudCBzZWdtZW50XG4gKi9cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmZpbmRQYXJlbnRTZWdtZW50QnlDaGlsZElkID0gZnVuY3Rpb24oc2VnbWVudElkKSB7XG5cdGlmICghZmFzdE1hdGguaXNOdW1lcmljKHNlZ21lbnRJZCkgfHwgZmFzdE1hdGgubHQoc2VnbWVudElkLCAwKSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ2V4cGVjdCBzZWdtZW50SWQgdG8gYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJyk7XG5cblx0dmFyIGNoaWxkU2VnbWVudDtcblx0dmFyIHBhcmVudFNlZ21lbnRzID0gdGhpcy5nZXRBbGxTZWdtZW50cygpO1xuXG5cdC8vIGdvIHRocm91Z2ggYWxsIHBhcmVudCBzZWdtZW50cyBhbmQgdXRpbGl6ZSBpdHMgc3Rhc2ggdG8gdHJ5IHRvIGZpbmQgdGhlIGNoaWxkXG5cdGZvciAodmFyIGkgPSBwYXJlbnRTZWdtZW50cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuXHRcdGNoaWxkU2VnbWVudCA9IHBhcmVudFNlZ21lbnRzW2ldLnNlZ21lbnRzLmZpbmRCeUlkKHNlZ21lbnRJZCk7XG5cdFx0aWYgKGNoaWxkU2VnbWVudClcblx0XHRcdHJldHVybiBwYXJlbnRTZWdtZW50c1tpXTtcblx0fVxuXG5cdHJldHVybiBudWxsO1xufTtcblxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge2ludH0gc2VnbWVudElkXG4gKiBAcGFyYW0ge09iamVjdH0gbmV3U2VnbWVudERhdGEgbmV3IHNlZ21lbnQgZGF0YVxuICogQHBhcmFtIHtPYmplY3R9IGluaXRpYWxDb25kaXRpb25zIGluaXRpYWwgY29uZGl0aW9ucyBmb3IgdGhlIG1vZGlmaWVkIHNlZ21lbnRcbiAqIEByZXR1cm5zIHtNb3Rpb25TZWdtZW50fVxuICovXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5tb2RpZnlTZWdtZW50VmFsdWVzID0gZnVuY3Rpb24oc2VnbWVudElkLCBuZXdTZWdtZW50RGF0YSwgaW5pdGlhbENvbmRpdGlvbnMpIHtcblx0dmFyIHNlZ21lbnQgPSB0aGlzLmZpbmRCeUlkKHNlZ21lbnRJZCk7XG5cdGlmICghc2VnbWVudClcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJVbmFibGUgdG8gZmluZCBzZWdtZW50IHdpdGggaWQgXCIgKyBzZWdtZW50SWQpO1xuXG5cdHZhciBvcmlnaW5hbFNlZ21lbnREYXRhID0ge307XG5cdFV0aWwuZXh0ZW5kKG9yaWdpbmFsU2VnbWVudERhdGEsIHNlZ21lbnQuc2VnbWVudERhdGEpO1xuXG5cdHZhciBtb2RpZmllZCA9IHNlZ21lbnQubW9kaWZ5U2VnbWVudFZhbHVlcyhuZXdTZWdtZW50RGF0YSwgaW5pdGlhbENvbmRpdGlvbnMpO1xuXG5cdC8vdW5kbyAvIHJlZG9cblx0dmFyIHByb2ZpbGUgPSB0aGlzO1xuXHR0aGlzLnVuZG9NYW5hZ2VyLmFkZCh7XG5cdFx0dW5kbzogZnVuY3Rpb24oKSB7XG5cdFx0XHRwcm9maWxlLm1vZGlmeVNlZ21lbnRWYWx1ZXMoc2VnbWVudElkLCBvcmlnaW5hbFNlZ21lbnREYXRhLCBpbml0aWFsQ29uZGl0aW9ucyk7XG5cdFx0fSxcblx0XHRyZWRvOiBmdW5jdGlvbigpIHtcblx0XHRcdHByb2ZpbGUubW9kaWZ5U2VnbWVudFZhbHVlcyhzZWdtZW50SWQsIG5ld1NlZ21lbnREYXRhLCBpbml0aWFsQ29uZGl0aW9ucyk7XG5cdFx0fVxuXHR9KTtcblxuXHRyZXR1cm4gbW9kaWZpZWQ7XG59O1xuXG5cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcblx0aWYgKCF0aGlzLnVuZG9NYW5hZ2VyLmhhc1VuZG8oKSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJUaGVyZSBpcyBub3RoaW5nIHRvIHVuZG9cIik7XG5cdHRoaXMudW5kb01hbmFnZXIudW5kbygpO1xufTtcblxuXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5yZWRvID0gZnVuY3Rpb24oKSB7XG5cblx0aWYgKCF0aGlzLnVuZG9NYW5hZ2VyLmhhc1JlZG8oKSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJUaGVyZSBpcyBub3RoaW5nIHRvIHJlZG9cIik7XG5cblx0dGhpcy51bmRvTWFuYWdlci5yZWRvKCk7XG59O1xuXG5cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmZpbmRCeUlkID0gZnVuY3Rpb24oc2VnbWVudElkKSB7XG5cdHJldHVybiB0aGlzLnNlZ21lbnRzLmZpbmRCeUlkKHNlZ21lbnRJZCk7XG59O1xuXG5cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmNyZWF0ZUxvYWRTZWdtZW50ID0gZnVuY3Rpb24odHlwZSwgdDAsIHRmLCBpbml0aWFsTG9hZCwgZmluYWxMb2FkKSB7XG5cdGlmICghTG9hZFNlZ21lbnQuTG9hZFNlZ21lbnQucHJvdG90eXBlLmlzVmFsaWRUeXBlKHRoaXMudHlwZSwgdHlwZSkpXG5cdFx0dGhyb3cgbmV3IEVycm9yKFwiTG9hZCB0eXBlICdcIiArIHR5cGUgKyBcIicgaXMgbm90IHZhbGlkIGZvciBcIiArIHRoaXMudHlwZSArIFwiIHByb2ZpbGVzXCIpO1xuXG5cdHJldHVybiBMb2FkU2VnbWVudC5jcmVhdGVMb2FkU2VnbWVudCh0eXBlLCB0MCwgdGYsIGluaXRpYWxMb2FkLCBmaW5hbExvYWQpO1xufTtcblxuXG4vKipcbiAqIEdldHMgdmFsaWQgbG9hZCB0eXBlcyBmb3IgcHJvZmlsZSB0eXBlXG4gKiBAcmV0dXJuIHtBcnJheX0gdmFsaWQgbG9hZCB0eXBlc1xuICovXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5nZXRWYWxpZExvYWRUeXBlcyA9IGZ1bmN0aW9uKCkge1xuXHRpZih0aGlzLnR5cGUgPT0gJ2xpbmVhcicpIHtcblx0XHRyZXR1cm4gTG9hZFNlZ21lbnQuTGluZWFyTG9hZHNFbnVtO1xuXHR9IGVsc2UgaWYgKHRoaXMudHlwZSA9PSAncm90YXJ5Jykge1xuXHRcdHJldHVybiBMb2FkU2VnbWVudC5Sb3RhcnlMb2Fkc0VudW07XG5cdH1cblxuXHR0aHJvdyBuZXcgRXJyb3IoJ1VucmVjb2duaXplZCBwcm9maWxlIHR5cGU6ICcgKyB0aGlzLnR5cGUpO1xufTtcblxuXG4vKipcbiAqIEFkZHMgYSBsb2FkIHNlZ21lbnQgdG8gdGhlIHByb2ZpbGVcbiAqIEBwYXJhbSB7TG9hZFNlZ21lbnR9IGxvYWRTZWdtZW50IGxvYWQgc2VnbWVudCB0byBiZSBhZGRlZFxuICovXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5hZGRMb2FkU2VnbWVudCA9IGZ1bmN0aW9uKGxvYWRTZWdtZW50KSB7XG5cdC8vIGluc2VydCBvciBhcHBlbmRcblx0aWYgKHRoaXMucHJvZmlsZUxvYWRzW2xvYWRTZWdtZW50LnNlZ21lbnREYXRhLmxvYWRUeXBlXS5maW5kT3ZlcmxhcHBpbmdTZWdtZW50KGxvYWRTZWdtZW50LmluaXRpYWxUaW1lLCBsb2FkU2VnbWVudC5maW5hbFRpbWUpKVxuXHRcdHRocm93IG5ldyBFcnJvcihcIk5ldyBzZWdtZW50IG92ZXJsYXBzIGFuIGV4aXN0aW5nIHNlZ21lbnRcIik7XG5cblx0Ly8gZmluZCBwcmV2aW91cyBzZWdtZW50LiBOZWVkZWQgaW4gY2FzZSBvZiBpbnNlcnRpb25cblx0dmFyIHByZXZTZWdtZW50ID0gdGhpcy5wcm9maWxlTG9hZHNbbG9hZFNlZ21lbnQuc2VnbWVudERhdGEubG9hZFR5cGVdLmdldFByZXZpb3VzQnlJbml0aWFsVGltZShsb2FkU2VnbWVudC50MCk7XG5cdHZhciBwcmV2SWQgPSBudWxsO1xuXHRpZiAocHJldlNlZ21lbnQpXG5cdFx0cHJldklkID0gcHJldlNlZ21lbnQuaWQ7XG5cblx0aWYgKHRoaXMucHJvZmlsZUxvYWRzW2xvYWRTZWdtZW50LnNlZ21lbnREYXRhLmxvYWRUeXBlXS5jb3VudFNlZ21lbnRzKCkgPT09IDApIHtcblx0XHR0aGlzLnByb2ZpbGVMb2Fkc1tsb2FkU2VnbWVudC5zZWdtZW50RGF0YS5sb2FkVHlwZV0uaW5zZXJ0QXQobG9hZFNlZ21lbnQsIHByZXZJZCk7XG5cdH0gZWxzZVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkN1cnJlbnRseSwgb25seSBvbmUgc2VnbWVudCBwZXIgdHlwZSBjYW4gYmUgYWRkZWRcIik7XG5cblx0Ly8gdW5kby9yZWRvXG5cdHZhciBwcm9maWxlID0gdGhpcztcblx0dGhpcy51bmRvTWFuYWdlci5hZGQoe1xuXHRcdHVuZG86IGZ1bmN0aW9uKCkge1xuXHRcdFx0cHJvZmlsZS5kZWxldGVMb2FkU2VnbWVudChsb2FkU2VnbWVudC5pZCwgbG9hZFNlZ21lbnQuc2VnbWVudERhdGEubG9hZFR5cGUpO1xuXHRcdH0sXG5cdFx0cmVkbzogZnVuY3Rpb24oKSB7XG5cdFx0XHRwcm9maWxlLmFkZExvYWRTZWdtZW50KGxvYWRTZWdtZW50KTtcblx0XHR9XG5cdH0pO1xufTtcblxuXG4vKipcbiAqIERlbGV0ZXMgbG9hZCBzZWdtZW50IGlkZW50aWZpZWQgYnkgc2VnbWVudElkLCBvcHRpb25hbGx5IHVzZXMgdHlwZSB0byBpZGVudGlmeSBsb2FkIHR5cGVcbiAqIEBwYXJhbSAge051bWJlcn0gc2VnbWVudElkIGlkZW50ZmllcyBzZWdtZW50XG4gKiBAcGFyYW0gIHtzdHJpbmd9IHR5cGUgICAgICBsb2FkIHR5cGVcbiAqIEByZXR1cm4ge0xvYWRTZWdtZW50fSAgICAgIGRlbGV0ZWQgbG9hZCBzZWdtZW50XG4gKi9cbk1vdGlvblByb2ZpbGUucHJvdG90eXBlLmRlbGV0ZUxvYWRTZWdtZW50ID0gZnVuY3Rpb24oc2VnbWVudElkLCB0eXBlKSB7XG5cdC8vIHBhc3NpbmcgIHR5cGUgaXMgb3B0aW9uYWwsIGJ1dCBoZWxwZnVsXG5cdGlmICh0eXBlKSB7XG5cdFx0aWYgKCF0aGlzLnByb2ZpbGVMb2Fkc1t0eXBlXSlcblx0XHRcdHRocm93IG5ldyBFcnJvcihcImxvYWQgdHlwZSAnXCIgKyB0eXBlICsgXCInIGRvZXNuJ3QgYXBwZWFyIHRvIGJlIGEgdmFsaWQgbG9hZCBzZWdtZW50IHR5cGVcIik7XG5cdFx0cmV0dXJuIHRoaXMucHJvZmlsZUxvYWRzW3R5cGVdLmRlbGV0ZShzZWdtZW50SWQpO1xuXHR9XG5cblx0dmFyIGRlbGV0ZWRTZWdtZW50O1xuXG5cdHZhciB0aGF0ID0gdGhpcztcblxuXHQvLyB0eXBlIHdhcyBub3QgcGFzc2VkLCBoYXZlIHRvIGNoZWNrIGFsbCB0eXBlc1xuXHRPYmplY3Qua2V5cyh0aGlzLnByb2ZpbGVMb2Fkcykuc29tZShmdW5jdGlvbih0KSB7XG5cdFx0ZGVsZXRlZFNlZ21lbnQgPSB0aGF0LnByb2ZpbGVMb2Fkc1t0XS5kZWxldGUoc2VnbWVudElkKTtcblx0XHRyZXR1cm4gZGVsZXRlZFNlZ21lbnQgIT09IG51bGw7XG5cdH0pO1xuXG5cdC8vdW5kbyAvIHJlZG9cblx0dmFyIHByb2ZpbGUgPSB0aGlzO1xuXHR0aGlzLnVuZG9NYW5hZ2VyLmFkZCh7XG5cdFx0dW5kbzogZnVuY3Rpb24oKSB7XG5cdFx0XHRwcm9maWxlLmFkZExvYWRTZWdtZW50KGRlbGV0ZWRTZWdtZW50KTtcblx0XHR9LFxuXHRcdHJlZG86IGZ1bmN0aW9uKCkge1xuXHRcdFx0cHJvZmlsZS5kZWxldGVMb2FkU2VnbWVudChzZWdtZW50SWQsIHR5cGUpO1xuXHRcdH1cblx0fSk7XG5cblx0cmV0dXJuIGRlbGV0ZWRTZWdtZW50O1xufTtcblxuXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5tb2RpZnlMb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHNlZ21lbnRJZCwgbmV3U2VnbWVudERhdGEpIHtcblx0aWYgKCFuZXdTZWdtZW50RGF0YS5zZWdtZW50RGF0YS5sb2FkVHlwZSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RpbmcgbmV3IHNlZ21lbnQgdG8gaGF2ZSB0eXBlXCIpO1xuXG5cdC8vZm9yY2luZyBuZXcgc2VnbWVudCB0byBiZSB0aGUgc2FtZSB0eXBlIGFzIG9sZCBzZWdtZW50XG5cdHZhciBzZWdtZW50ID0gdGhpcy5wcm9maWxlTG9hZHNbbmV3U2VnbWVudERhdGEuc2VnbWVudERhdGEubG9hZFR5cGVdLmZpbmRCeUlkKHNlZ21lbnRJZCk7XG5cdGlmICghc2VnbWVudClcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJVbmFibGUgdG8gZmluZCBzZWdtZW50IHdpdGggaWQgXCIgKyBzZWdtZW50SWQgKyBcIi4uIGlzIGl0IG9mIHRoZSBzYW1lIHR5cGUgYXMgdGhlIG9sZCBvbmU/XCIpO1xuXG5cdHRoaXMucHJvZmlsZUxvYWRzW25ld1NlZ21lbnREYXRhLnNlZ21lbnREYXRhLmxvYWRUeXBlXS5kZWxldGUoc2VnbWVudElkKTtcblxuXHR0aGlzLmFkZExvYWRTZWdtZW50KG5ld1NlZ21lbnREYXRhKTtcblxuXHQvL3VuZG8gLyByZWRvXG5cdHZhciBwcm9maWxlID0gdGhpcztcblx0dGhpcy51bmRvTWFuYWdlci5hZGQoe1xuXHRcdHVuZG86IGZ1bmN0aW9uKCkge1xuXHRcdFx0cHJvZmlsZS5kZWxldGVMb2FkU2VnbWVudChuZXdTZWdtZW50RGF0YS5pZCk7XG5cdFx0XHRwcm9maWxlLmFkZExvYWRTZWdtZW50KHNlZ21lbnQsIHNlZ21lbnQudHlwZSk7XG5cdFx0fSxcblx0XHRyZWRvOiBmdW5jdGlvbigpIHtcblx0XHRcdHByb2ZpbGUubW9kaWZ5TG9hZFNlZ21lbnQoc2VnbWVudElkLCBuZXdTZWdtZW50RGF0YSk7XG5cdFx0fVxuXHR9KTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIGFsbCBsb2FkIHNlZ21lbnRzIHByZXNlbnQgaW4gdGhlIG1vdGlvbiBwcm9maWxlIG9mIHRoZSBzcGVjaWZpZWQgdHlwZVxuICogQHBhcmFtICB7c3RyaW5nfSB0eXBlIExvYWQgdHlwZVxuICogQHJldHVybiB7QXJyYXl9ICAgICAgYXJyYXkgb2YgbG9hZCBzZWdtZW50cyBvZiBzcGVjaWZpZWQgdHlwZVxuICovXG5Nb3Rpb25Qcm9maWxlLnByb3RvdHlwZS5nZXRBbGxMb2FkU2VnbWVudHMgPSBmdW5jdGlvbih0eXBlKSB7XG5cblx0Ly8gaWYgdGhlcmUgaXMgbm90IHNwZWNpZmljIHR5cGUsIGFsbCBsb2FkIHNlZ21lbnRzIGFyZSByZXR1cm5lZFxuXHRpZighdHlwZSkge1xuXHRcdHZhciBhbGxMb2FkU2VnbWVudHM9W107XG5cdFx0dmFyIHRoYXQ9dGhpcztcblx0XHRPYmplY3Qua2V5cyh0aGlzLmdldFZhbGlkTG9hZFR5cGVzKCkpLmZvckVhY2goZnVuY3Rpb24odHlwZSl7XG5cdFx0XHRhbGxMb2FkU2VnbWVudHM9YWxsTG9hZFNlZ21lbnRzLmNvbmNhdCh0aGF0LnByb2ZpbGVMb2Fkc1t0eXBlXS5nZXRBbGxTZWdtZW50cygpKTtcblx0XHR9KTtcblx0XHRyZXR1cm4gYWxsTG9hZFNlZ21lbnRzO1xuXHR9XG5cblx0aWYgKCF0aGlzLnByb2ZpbGVMb2Fkc1t0eXBlXSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJsb2FkIHR5cGUgJ1wiICsgdHlwZSArIFwiJyBkb2Vzbid0IGFwcGVhciB0byBiZSBhIHZhbGlkIGxvYWQgc2VnbWVudCB0eXBlXCIpO1xuXG5cdHJldHVybiB0aGlzLnByb2ZpbGVMb2Fkc1t0eXBlXS5nZXRBbGxTZWdtZW50cygpO1xufTtcblxudmFyIGZhY3RvcnkgPSB7fTtcblxuZmFjdG9yeS5jcmVhdGVNb3Rpb25Qcm9maWxlID0gZnVuY3Rpb24odHlwZSkge1xuXHRyZXR1cm4gbmV3IE1vdGlvblByb2ZpbGUodHlwZSk7XG59O1xuXG5cbi8qKlxuICogQ3JlYXRlcyBhY2NlbCBzZWdtZW50XG4gKiBAcGFyYW0gIHtzdHJpbmd9IHR5cGUgICAgYWJzb2x1dGUgb3IgaW5jcmVtZW50YWxcbiAqIEBwYXJhbSAge09iamVjdH0gc2VnbWVudCBzZWdtZW50IGRhdGEgZnJvbSB0aGUgdXNlclxuICogQHJldHVybiB7QWNjZWxTZWdtZW50fSAgICAgICAgIG5ld2x5IGNyZWF0ZWQgYWNjZWxlcmF0aW9uIHNlZ21lbnRcbiAqL1xuZmFjdG9yeS5jcmVhdGVBY2NlbFNlZ21lbnQgPSBmdW5jdGlvbih0eXBlLCBzZWdtZW50KSB7XG5cdGlmICghdHlwZSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ05lZWQgdHlwZSBvZiBzZWdtZW50IHRvIGNyZWF0ZScpO1xuXG5cdGlmICghc2VnbWVudClcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJOZWVkIHNlZ21lbnQgZGF0YSB0byBjcmVhdGUgYSBzZWdtZW50XCIpO1xuXG5cdHZhciBsb2FkcyA9IHt9O1xuXG5cdGxvYWRzLmxvYWQgPSBzZWdtZW50LmxvYWQ7XG5cdGxvYWRzLnRocnVzdCA9IHNlZ21lbnQudGhydXN0O1xuXHRsb2Fkcy5mcmljdGlvbiA9IHNlZ21lbnQuZnJpY3Rpb247XG5cblx0c3dpdGNoICh0eXBlKSB7XG5cdFx0Y2FzZSBcInRpbWUtZGlzdGFuY2VcIjpcblx0XHRcdHJldHVybiBBY2NlbFNlZ21lbnQuTWFrZUZyb21UaW1lRGlzdGFuY2Uoc2VnbWVudC50MCwgc2VnbWVudC50Ziwgc2VnbWVudC5wMCwgc2VnbWVudC52MCwgc2VnbWVudC5wZiwgc2VnbWVudC5qUGN0LCBzZWdtZW50Lm1vZGUsIGxvYWRzKTtcblx0XHRjYXNlIFwidGltZS12ZWxvY2l0eVwiOlxuXHRcdFx0cmV0dXJuIEFjY2VsU2VnbWVudC5NYWtlRnJvbVRpbWVWZWxvY2l0eShzZWdtZW50LnQwLCBzZWdtZW50LnRmLCBzZWdtZW50LnAwLCBzZWdtZW50LnYwLCBzZWdtZW50LnZmLCBzZWdtZW50LmpQY3QsIHNlZ21lbnQubW9kZSwgbG9hZHMpO1xuXG5cdFx0ZGVmYXVsdDpcblx0XHRcdHRocm93IG5ldyBFcnJvcihcInNlZ21lbnQgdHlwZSBub3Qgc3VwcG9ydGVkXCIpO1xuXHR9XG59O1xuXG5cbmZhY3RvcnkuY3JlYXRlSW5kZXhTZWdtZW50ID0gZnVuY3Rpb24oc2VnbWVudCkge1xuXG5cdGlmICghc2VnbWVudClcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJOZWVkIHNlZ21lbnQgZGF0YSB0byBjcmVhdGUgYSBzZWdtZW50XCIpO1xuXG5cdC8vIGZ1bmN0aW9uKHQwLCB0ZiwgcDAsIHBmLCB2LCB2ZWxMaW1Qb3MsIHZlbExpbU5lZywgYWNjSmVyaywgZGVjSmVyaywgeFNrZXcsIHlTa2V3LCBzaGFwZSwgbW9kZSlcblx0cmV0dXJuIEluZGV4U2VnbWVudC5NYWtlKHNlZ21lbnQudDAsIHNlZ21lbnQudGYsIHNlZ21lbnQucDAsIHNlZ21lbnQucGYsIHNlZ21lbnQudiwgc2VnbWVudC52ZWxMaW1Qb3MsIHNlZ21lbnQudmVsTGltTmVnLCBzZWdtZW50LmFjY0plcmssIHNlZ21lbnQuZGVjSmVyaywgc2VnbWVudC54U2tldywgc2VnbWVudC55U2tldywgc2VnbWVudC5zaGFwZSwgc2VnbWVudC5tb2RlKTtcbn07XG5cbmZhY3RvcnkuY3JlYXRlQ2FtU2VnbWVudCA9IGZ1bmN0aW9uKHByZXZUaW1lLHByZXZQb3NpdGlvbixwcmV2VmVsb2NpdHksbG9hZHMpIHtcblx0cmV0dXJuIENhbVNlZ21lbnQuY3JlYXRlQ2FtU2VnbWVudChwcmV2VGltZSxwcmV2UG9zaXRpb24scHJldlZlbG9jaXR5LGxvYWRzKTtcbn07XG5cblxuZmFjdG9yeS5jcmVhdGVMb2FkU2VnbWVudCA9IGZ1bmN0aW9uKGxvYWRUeXBlLCB0MCwgdGYsIGluaXRWYWwsIGZpbmFsVmFsICl7XG5cdHJldHVybiBMb2FkU2VnbWVudC5jcmVhdGVMb2FkU2VnbWVudChsb2FkVHlwZSwgdDAsIHRmLCBpbml0VmFsLCBmaW5hbFZhbCk7XG59O1xuXG5cbi8qKlxuICogRXhwb3J0cyBwcm9maWxlIGRhdGEgdG8gSlNPTiB0byBiZSBzYXZlZFxuICogQHBhcmFtIHtPYmplY3R9IHByb2ZpbGUgTW90aW9uUHJvZmlsZSB0byBiZSBzZXJpYWxpemVkXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEpTT04gcmVwcmVzZW50YXRpb24gb2YgdGhlIGVudGlyZSBwcm9maWxlXG4gKi9cbmZhY3Rvcnkuc2VyaWFsaXplID0gZnVuY3Rpb24ocHJvZmlsZSkge1xuXHR2YXIgcHJvZmlsZU9iaiA9IHt9O1xuXG5cdHByb2ZpbGVPYmoudHlwZSA9IHByb2ZpbGUudHlwZTtcblx0cHJvZmlsZU9iai5pbml0aWFsUG9zaXRpb24gPSBwcm9maWxlLmluaXRpYWxQb3NpdGlvbjtcblx0cHJvZmlsZU9iai5pbml0aWFsVmVsb2NpdHkgPSBwcm9maWxlLmluaXRpYWxWZWxvY2l0eTtcblx0cHJvZmlsZU9iai5pbml0aWFsTG9hZCA9IHByb2ZpbGUuaW5pdGlhbExvYWQ7XG5cdHByb2ZpbGVPYmouaW5pdGlhbFRocnVzdCA9IHByb2ZpbGUuaW5pdGlhbFRocnVzdDtcblx0cHJvZmlsZU9iai5pbml0aWFsRnJpY3Rpb24gPSBwcm9maWxlLmluaXRpYWxGcmljdGlvbjtcblxuXHR2YXIgc2VnbWVudHMgPSBbXTtcblx0dmFyIGxvYWRTZWdtZW50cyA9IFtdO1xuXG5cdHByb2ZpbGUuZ2V0QWxsU2VnbWVudHMoKS5mb3JFYWNoKGZ1bmN0aW9uKHNlZ21lbnQpIHtcblx0XHR2YXIgc2VnRGF0YSA9IHNlZ21lbnQuZXhwb3J0RGF0YSgpO1xuXHRcdHNlZ21lbnRzLnB1c2goc2VnRGF0YSk7XG5cdH0pO1xuXG5cdHByb2ZpbGUuZ2V0QWxsTG9hZFNlZ21lbnRzKCkuZm9yRWFjaChmdW5jdGlvbihsb2FkU2VnKSB7XG5cdFx0bG9hZFNlZ21lbnRzLnB1c2gobG9hZFNlZy5leHBvcnREYXRhKCkpO1xuXHR9KTtcblxuXHRwcm9maWxlT2JqLnNlZ21lbnRzID0gc2VnbWVudHM7XG5cdHByb2ZpbGVPYmoubG9hZFNlZ21lbnRzID0gbG9hZFNlZ21lbnRzO1xuXG5cdHJldHVybiBKU09OLnN0cmluZ2lmeShwcm9maWxlT2JqKTtcbn07XG5cblxuLyoqXG4gKiBEZXNlcmFsaXplXG4gKiBAcGFyYW0gIHtbdHlwZV19IGpzb24gW2Rlc2NyaXB0aW9uXVxuICogQHJldHVybiB7W3R5cGVdfSAgICAgIFtkZXNjcmlwdGlvbl1cbiAqL1xuZmFjdG9yeS5kZXNlcmlhbGl6ZSA9IGZ1bmN0aW9uKGpzb25Qcm9maWxlKSB7XG5cdHZhciBwcm9maWxlR3JhcGg7XG5cdHRyeSB7XG5cdFx0cHJvZmlsZUdyYXBoID0gSlNPTi5wYXJzZShqc29uUHJvZmlsZSk7XG5cdH0gY2F0Y2ggKGUpIHtcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJVbmFibGUgdG8gcGFyc2UgSlNPTiBzdHJpbmdcIik7XG5cdH1cblxuXHR2YXIgcHJvZmlsZU9iaiA9IHByb2ZpbGVHcmFwaDtcblx0aWYgKCFwcm9maWxlT2JqKVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGluZyBrZXkgJ3Byb2ZpbGUnIHRvIGV4aXN0IGluIHRoZSBqc29uIHN0cmluZ1wiKTtcblxuXHR2YXIgdGhhdCA9IHRoaXM7XG5cblx0dmFyIHByb2ZpbGUgPSBuZXcgTW90aW9uUHJvZmlsZShwcm9maWxlT2JqLnR5cGUpO1xuXHRwcm9maWxlR3JhcGguc2VnbWVudHMuZm9yRWFjaChmdW5jdGlvbihzZWdPYmopIHtcblx0XHR2YXIgc2VnbWVudCA9IHRoYXRbc2VnT2JqLnR5cGVdLnByb3RvdHlwZS5pbXBvcnRGcm9tRGF0YShzZWdPYmopO1xuXHRcdHByb2ZpbGUuYXBwZW5kU2VnbWVudChzZWdtZW50KTtcblx0fSk7XG5cblx0cHJvZmlsZUdyYXBoLmxvYWRTZWdtZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGxvYWRPYmope1xuXHRcdHZhciBsb2FkU2VnPUxvYWRTZWdtZW50LmNyZWF0ZUxvYWRTZWdtZW50KGxvYWRPYmoubG9hZFR5cGUsXG5cdFx0bG9hZE9iai5pbml0aWFsVGltZSwgbG9hZE9iai5maW5hbFRpbWUsXG5cdFx0bG9hZE9iai5pbml0aWFsVmFsdWUsIGxvYWRPYmouZmluYWxWYWx1ZSk7XG5cdFx0cHJvZmlsZS5hZGRMb2FkU2VnbWVudChsb2FkU2VnKTtcblx0fSk7XG5cblxuXHRyZXR1cm4gcHJvZmlsZTtcbn07XG5cblxuZmFjdG9yeS5BY2NlbE1vdGlvblNlZ21lbnQgPSBBY2NlbFNlZ21lbnQuQWNjZWxNb3Rpb25TZWdtZW50O1xuZmFjdG9yeS5JbmRleE1vdGlvblNlZ21lbnQgPSBJbmRleFNlZ21lbnQuSW5kZXhNb3Rpb25TZWdtZW50O1xuZmFjdG9yeS5DYW1Nb3Rpb25TZWdtZW50ID0gQ2FtU2VnbWVudC5DYW1Nb3Rpb25TZWdtZW50O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZhY3Rvcnk7IiwidmFyIGZhc3RNYXRoID0gcmVxdWlyZSgnLi4vdXRpbC9mYXN0TWF0aCcpO1xudmFyIGJhc2ljU2VnbWVudEZhY3RvcnkgPSByZXF1aXJlKCcuLi9zZWdtZW50cy9iYXNpY1NlZ21lbnQnKTtcblxuXG5leHBvcnRzLnNvcnRCYXNpY1NlZ21lbnRzID0gZnVuY3Rpb24oYmFzaWNTZWdtZW50cykge1xuXHR0aGlzLnZhbGlkYXRlU2VnbWVudHMoYmFzaWNTZWdtZW50cyk7XG5cblx0Ly8gc2luY2Ugc2VnbWVudHMgYXJlIHZhbGlkYXRlZCwgd2UgY2FuIGp1c3Qgc29ydCBvbiBpbml0aWFsIHRpbWVcblx0dmFyIHNvcnRlZCA9IGJhc2ljU2VnbWVudHMuc29ydChmdW5jdGlvbihzZWdtZW50QSwgc2VnbWVudEIpIHtcblx0XHRyZXR1cm4gZmFzdE1hdGguY29tcGFyZU51bWJlcnMoc2VnbWVudEEudDAsIHNlZ21lbnRCLnQwKTtcblx0fSk7XG5cblx0cmV0dXJuIHNvcnRlZDtcblxufTtcblxuZXhwb3J0cy52YWxpZGF0ZUJhc2ljU2VnbWVudHMgPSBmdW5jdGlvbihiYXNpY1NlZ21lbnRzKSB7XG5cdGlmICghQXJyYXkuaXNBcnJheShiYXNpY1NlZ21lbnRzKSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ3NvcnRCYXNpY1NlZ21lbnRzIGV4cGVjdHMgYW4gYXJyYXknKTtcblxuXHRmb3IgKHZhciBpID0gMDsgaSA8PSBiYXNpY1NlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuXHRcdHZhciBzZWdtZW50ID0gYmFzaWNTZWdtZW50c1tpXTtcblxuXHRcdGlmICghKHNlZ21lbnQgaW5zdGFuY2VvZiBiYXNpY1NlZ21lbnRGYWN0b3J5LkJhc2ljTW90aW9uU2VnbWVudCkpXG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ3NlZ21lbnQgYCcgKyBpICsgJ2AgaXMgbm90IE1vdGlvblNlZ21lbnQgdHlwZScpO1xuXG5cdFx0aWYgKGZhc3RNYXRoLmVxdWFsKHNlZ21lbnQuaW5pdGlhbFRpbWUsIHNlZ21lbnQuZmluYWxUaW1lKSlcblx0XHRcdHRocm93IG5ldyBFcnJvcignU2VnbWVudCBzdGFydGluZyBhdCAnICsgc2VnbWVudC5pbml0aWFsVGltZSArICcgaGFzIHRoZSBzYW1lIGZpbmFsIHRpbWUnKTtcblxuXHRcdGlmIChmYXN0TWF0aC5ndChzZWdtZW50LmluaXRpYWxUaW1lLCBzZWdtZW50LmZpbmFsVGltZSkpXG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnQgc3RhcnRpbmcgYXQgJyArIHNlZ21lbnQuaW5pdGlhbFRpbWUgKyAnaGFzIGluaXRpYWwgdGltZSBncmVhdGVyIHRoYW4gZmluYWwgdGltZScpO1xuXG5cdFx0Ly9za2lwIHRoaXMgZm9yIHRoZSBmaXJzdCBzZWdtZW50XG5cdFx0aWYgKGkgPiAwKSB7XG5cdFx0XHRpZiAoZmFzdE1hdGgubm90RXF1YWwoc2VnbWVudC5pbml0aWFsVGltZSwgYmFzaWNTZWdtZW50c1tpIC0gMV0uZmluYWxUaW1lKSlcblx0XHRcdFx0dGhyb3cgbmV3IEVycm9yKCdTZWdtZW50IHN0YXJ0aW5nIGF0ICcgKyBzZWdtZW50LmluaXRpYWxUaW1lICsgJyBkb2VzIG5vdCBoYXZlIHQwIHNhbWUgYXMgcHJldmlvdXMgc2VnbWVudCB0ZicpO1xuXG5cdFx0XHRpZiAoZmFzdE1hdGgubm90RXF1YWwoc2VnbWVudC5pbml0aWFsVmVsb2NpdHksIGJhc2ljU2VnbWVudHNbaSAtIDFdLmZpbmFsVmVsb2NpdHkpKVxuXHRcdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ1NlZ21lbnQgc3RhcnRpbmcgYXQgJyArIHNlZ21lbnQuaW5pdGlhbFRpbWUgKyAnOiBwcmV2aW91cyBzZWdtZW50IGZpbmFsIHZlbG9jaXR5IGRvZXMgbm90IG1hdGNoJyk7XG5cblx0XHRcdGlmIChmYXN0TWF0aC5ub3RFcXVhbChzZWdtZW50LmluaXRpYWxQb3NpdGlvbiwgYmFzaWNTZWdtZW50c1tpIC0gMV0uZmluYWxQb3NpdGlvbikpXG5cdFx0XHRcdHRocm93IG5ldyBFcnJvcignU2VnbWVudCBzdGFydGluZyBhdCAnICsgc2VnbWVudC5pbml0aWFsVGltZSArICc6IHByZXZpb3VzIHNlZ21lbnQgZmluYWwgcG9zaXRpb24gZG9lcyBub3QgbWF0Y2gnKTtcblxuXG5cdFx0fVxuXG5cdH1cblx0cmV0dXJuIHRydWU7XG59IiwidmFyIE1vdGlvblNlZ21lbnQgPSByZXF1aXJlKCcuL21vdGlvblNlZ21lbnQnKTtcbnZhciBiYXNpY1NlZ21lbnRGYWN0b3J5ID0gcmVxdWlyZSgnLi9iYXNpY1NlZ21lbnQnKTtcbnZhciBmYXN0TWF0aCA9IHJlcXVpcmUoJy4uL3V0aWwvZmFzdE1hdGgnKTtcbnZhciBVdGlsID0gcmVxdWlyZSgnLi4vdXRpbC91dGlsJyk7XG5cbnZhciBmYWN0b3J5ID0ge307XG5cbi8qKlxuICogQWNjZWxNb3Rpb24gc2VnbWVudCBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHtBcnJheX0gYmFzaWNTZWdtZW50cyBbYXJyYXkgb2YgYmFzaWMgc2VnbWVudHNdXG4gKi9cbnZhciBBY2NlbE1vdGlvblNlZ21lbnQgPSBmdW5jdGlvbihiYXNpY1NlZ21lbnRzKSB7XG5cdGlmICghQXJyYXkuaXNBcnJheShiYXNpY1NlZ21lbnRzKSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBhbiBhcnJheSBwYXJhbWV0ZXInKTtcblx0aWYgKGJhc2ljU2VnbWVudHMubGVuZ3RoIDwgMSB8fCBiYXNpY1NlZ21lbnRzLmxlbmd0aCA+IDMpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgYXJheSBsZW5ndGggdG8gYmUgMSwyIG9yIDMnKTtcblxuXHR2YXIgdDAgPSBiYXNpY1NlZ21lbnRzWzBdLmluaXRpYWxUaW1lO1xuXHR2YXIgdGYgPSBiYXNpY1NlZ21lbnRzW2Jhc2ljU2VnbWVudHMubGVuZ3RoIC0gMV0uZmluYWxUaW1lO1xuXG5cdE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudC5jYWxsKHRoaXMsIHQwLCB0Zik7XG5cblx0Ly9UT0RPOiBjaGVjayBvcmRlcmluZyBvZiB0aGUgYmFzaWNTZWdtZW50cyAoaW5jcmVhc2luZyB0aW1lKVxuXG5cdHRoaXMudHlwZSA9ICdhY2NlbGVyYXRpb24nO1xuXG5cblx0Ly8gZWFjaCBzZWdtZW50IChyZWdhcmRsZXNzIG9mIHR5cGUpIGhhcyBpbml0aWFsVGltZSBhbmQgZmluYWxUaW1lXG5cdHRoaXMuaW5pdGlhbFRpbWUgPSBiYXNpY1NlZ21lbnRzWzBdLmluaXRpYWxUaW1lO1xuXHR0aGlzLmZpbmFsVGltZSA9IGJhc2ljU2VnbWVudHNbYmFzaWNTZWdtZW50cy5sZW5ndGggLSAxXS5maW5hbFRpbWU7XG5cblx0dGhpcy5zZWdtZW50cy5pbml0aWFsaXplV2l0aFNlZ21lbnRzKGJhc2ljU2VnbWVudHMpO1xufTtcblxuXG5BY2NlbE1vdGlvblNlZ21lbnQucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShNb3Rpb25TZWdtZW50Lk1vdGlvblNlZ21lbnQucHJvdG90eXBlKTtcbkFjY2VsTW90aW9uU2VnbWVudC5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBBY2NlbE1vdGlvblNlZ21lbnQ7XG5cblxuLyoqXG4gKiBHZXRzIHBlcnRpbmVudGEgZGF0YSB0byBiZSBhYmxlIHRvIHNlcmlhbGl6ZS9kZXNlcmlsaXplIHNlZ21lbnRcbiAqIEByZXR1cm4ge29iamVjdH0gZGF0YSByZXByZXNlbnRhdGlvbiBvZiB0aGUgc2VnbWVudFxuICovXG5BY2NlbE1vdGlvblNlZ21lbnQucHJvdG90eXBlLmV4cG9ydERhdGEgPSBmdW5jdGlvbigpIHtcblxuXHR2YXIgZGF0YU9iaj1Nb3Rpb25TZWdtZW50Lk1vdGlvblNlZ21lbnQucHJvdG90eXBlLmV4cG9ydERhdGEuY2FsbCh0aGlzKTtcblxuXHRkYXRhT2JqLnR5cGUgPSAnQWNjZWxNb3Rpb25TZWdtZW50JztcblxuXHRyZXR1cm4gZGF0YU9iajtcblxufTtcblxuLyoqXG4gKiBEZXNlcmlhbGl6ZShjcmVhdGUpIEFjY2VsTW90aW9uU2VnbWVudCBmcm9tIGEganNvbiBzdHJpbmdcbiAqIEBwYXJhbSAge09iamVjdH0gZGF0YSBkYXRhIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBzZWdtZW50IChzZWUgZXhwb3J0RGF0YSgpKVxuICogQHJldHVybiB7QWNjZWxNb3Rpb25TZWdtZW50fSAgICAgIFtkZXNjcmlwdGlvbl1cbiAqL1xuQWNjZWxNb3Rpb25TZWdtZW50LnByb3RvdHlwZS5pbXBvcnRGcm9tRGF0YSA9IGZ1bmN0aW9uKGRhdGEpIHtcblxuXHRzd2l0Y2ggKGRhdGEuY29uc3RydWN0b3IpIHtcblx0XHRjYXNlIFwiQWNjZWxTZWdtZW50VGltZVZlbG9jaXR5XCI6XG5cdFx0XHRyZXR1cm4gbmV3IEFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eSgwLCBkYXRhLmR1cmF0aW9uLCAwLCAwLCBkYXRhLmZpbmFsVmVsb2NpdHksIGRhdGEuamVya1BlcmNlbnQsIGRhdGEubW9kZSwgZGF0YS5sb2Fkcyk7XG5cblx0XHRjYXNlIFwiQWNjZWxTZWdtZW50VGltZURpc3RhbmNlXCI6XG5cdFx0XHRyZXR1cm4gbmV3IEFjY2VsU2VnbWVudFRpbWVEaXN0YW5jZSgwLCBkYXRhLmR1cmF0aW9uLCAwLCAwLCBkYXRhLmRpc3RhbmNlLCBkYXRhLmplcmtQZXJjZW50LCBkYXRhLm1vZGUsIGRhdGEubG9hZHMpO1xuXHR9XG5cblx0dGhyb3cgbmV3IEVycm9yKFwiVW5rb3duIEFjY2VsU2VnbWVudCB0eXBlOiBcIiArIGRhdGEuY29uc3RydWN0b3IpO1xuXG59O1xuXG5cblxudmFyIEFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eSA9IGZ1bmN0aW9uKHQwLCB0ZiwgcDAsIHYwLCB2ZiwgalBjdCwgbW9kZSwgbG9hZHMpIHtcblxuXHRpZiAoYXJndW1lbnRzLmxlbmd0aCA8PSA3KVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGF0IGxlYXN0IDcgYXJndW1lbnRzIGluIEFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eSBjb25zdHJ1Y3RvclwiKTtcblxuXHRpZiAobW9kZSAhPT0gXCJhYnNvbHV0ZVwiKVxuXHRcdG1vZGUgPSBcImluY3JlbWVudGFsXCI7XG5cblx0dmFyIGxvYWRzX2NvcHkgPSB7fTtcblx0VXRpbC5leHRlbmQobG9hZHNfY29weSwgbG9hZHMpO1xuXG5cdHRoaXMuc2VnbWVudERhdGEgPSB7XG5cdFx0ZGF0YVBlcm11dGF0aW9uOiBcInRpbWUtdmVsb2NpdHlcIixcblx0XHRtb2RlOiBtb2RlLFxuXHRcdGluaXRpYWxUaW1lOiB0MCxcblx0XHRmaW5hbFRpbWU6IHRmLFxuXHRcdGluaXRpYWxWZWxvY2l0eTogdjAsXG5cdFx0ZmluYWxWZWxvY2l0eTogdmYsXG5cdFx0ZHVyYXRpb246IHRmIC0gdDAsXG5cdFx0amVya1BlcmNlbnQ6IGpQY3QsXG5cdFx0bG9hZHM6IGxvYWRzX2NvcHlcblx0fTtcblxuXHR2YXIgYmFzaWNTZWdtZW50cyA9IHRoaXMuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyh0MCwgdGYsIHAwLCB2MCwgdmYsIGpQY3QpO1xuXG5cdEFjY2VsTW90aW9uU2VnbWVudC5jYWxsKHRoaXMsIGJhc2ljU2VnbWVudHMpO1xuXHR0aGlzLnNldEJhc2ljU2VnbWVudExvYWRzKGxvYWRzKTtcblxufTtcblxuXG5cbkFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEFjY2VsTW90aW9uU2VnbWVudC5wcm90b3R5cGUpO1xuQWNjZWxTZWdtZW50VGltZVZlbG9jaXR5LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eTtcblxuXG4vKipcbiAqIENhbGN1bGF0ZXMgYW5kIGNyZWF0ZXMgdGhlIDEgdG8gMyBiYXNpYyBzZWdtZW50cyB0aGF0IEFjY2VsU2VnbWVudCBjb25zaXN0cyBvZlxuICogQHBhcmFtICB7TnVtYmVyfSB0MCAgIGluaXRpYWwgdGltZVxuICogQHBhcmFtICB7TnVtYmVyfSB0ZiAgIGZpbmFsdCB0aW1lXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHAwICAgaW5pdGlhbCBwb3NpdGlvblxuICogQHBhcmFtICB7TnVtYmVyfSB2MCAgIGluaXRpYWwgdmVsb2NpdHlcbiAqIEBwYXJhbSAge051bWJlcn0gdmYgICBmaW5hbCB2ZWxvY2l0eVxuICogQHBhcmFtICB7TnVtYmVyfSBqUGN0IGplcmsgcGVyY2VudGFnZVxuICogQHJldHVybiB7QXJyYXl9ICAgICAgQXJyYXkgb2YgQmFzaWNTZWdtZW50XG4gKi9cbkFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eS5wcm90b3R5cGUuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyA9IGZ1bmN0aW9uKHQwLCB0ZiwgcDAsIHYwLCB2ZiwgalBjdCkge1xuXHR2YXIgYmFzaWNTZWdtZW50LCBiYXNpY1NlZ21lbnQyLCBiYXNpY1NlZ21lbnQzO1xuXHR2YXIgYWNjZWxTZWdtZW50O1xuXHR2YXIgY29lZmZzLCBjb2VmZnMxLCBjb2VmZnMyLCBjb2VmZnMzLCBjb2VmZnM0O1xuXG5cdGlmIChqUGN0ID09PSAwKSB7XG5cdFx0Ly8gY29uc2lzdHMgb2Ygb25lIGJhc2ljIHNlZ21lbnRcblx0XHRjb2VmZnMgPSBbMCwgMC41ICogKHZmIC0gdjApIC8gKHRmIC0gdDApLCB2MCwgcDBdO1xuXG5cdFx0YmFzaWNTZWdtZW50ID0gYmFzaWNTZWdtZW50RmFjdG9yeS5DcmVhdGVCYXNpY1NlZ21lbnQodDAsIHRmLCBjb2VmZnMpO1xuXG5cdFx0cmV0dXJuIFtiYXNpY1NlZ21lbnRdO1xuXHR9XG5cblx0dmFyIGFNYXg7XG5cdHZhciBqZXJrO1xuXHR2YXIgdGg7XG5cblx0aWYgKGpQY3QgPT0gMSkge1xuXHRcdC8vIHR3byBiYXNpYyBzZWdtZW50c1xuXG5cdFx0Ly8gdGggLSBkdXJhdGlvbiBvZiBoYWxmIHRoZSBhY2NlbCBzZWdtZW50XG5cdFx0dGggPSAodGYgLSB0MCkgLyAyO1xuXHRcdGFNYXggPSAodmYgLSB2MCkgLyB0aDtcblx0XHRqZXJrID0gYU1heCAvIHRoO1xuXG5cdFx0Y29lZmZzMSA9IFtqZXJrIC8gNiwgMCwgdjAsIHAwXTtcblxuXHRcdGJhc2ljU2VnbWVudCA9IGJhc2ljU2VnbWVudEZhY3RvcnkuQ3JlYXRlQmFzaWNTZWdtZW50KHQwLCB0MCArIHRoLCBjb2VmZnMxKTtcblxuXHRcdC8vIGNvZWZmczIgPSBbYmFzaWNTZWdtZW50LmV2YWx1YXRlUG9zaXRpb25BdCh0MCArIHRoKSwgYmFzaWNTZWdtZW50LmV2YWx1YXRlVmVsb2NpdHlBdCh0MCArIHRoKSwgYU1heCAvIDIsIC1qZXJrIC8gNl07XG5cdFx0Y29lZmZzMiA9IFstamVyayAvIDYsICBhTWF4IC8gMiwgYmFzaWNTZWdtZW50LmV2YWx1YXRlVmVsb2NpdHlBdCh0MCArIHRoKSwgYmFzaWNTZWdtZW50LmV2YWx1YXRlUG9zaXRpb25BdCh0MCArIHRoKV07XG5cblx0XHRiYXNpY1NlZ21lbnQyID0gYmFzaWNTZWdtZW50RmFjdG9yeS5DcmVhdGVCYXNpY1NlZ21lbnQodDAgKyB0aCwgdGYsIGNvZWZmczIpO1xuXG5cdFx0cmV0dXJuIFtiYXNpY1NlZ21lbnQsIGJhc2ljU2VnbWVudDJdO1xuXHR9XG5cblx0Ly8gbGFzdCBjYXNlIGlzIHRocmVlIGJhc2ljIHNlZ21lbnRzXG5cblx0dmFyIHRkMTsgLy9kdXJhdGlvbiBvZiBmaXJzdCBhbmQgdGhpcmQgc2VnbWVudHNcblx0dmFyIHRkbTsgLy9kdXJhdGlvbiBvZiB0aGUgbWlkZGxlIHNlZ21lbnRcblx0dGQxID0gMC41ICogalBjdCAqICh0ZiAtIHQwKTtcblx0dGRtID0gdGYgLSB0MCAtIDIgKiAodGQxKTtcblxuXHQvL2NhbGN1bGF0ZSBtYXggYWNjZWwgYnkgZGl2aWRpbmcgdGhlIHNlZ21lbnQgaW50byB0aHJlZSBjaHVua3Ncblx0Ly8gYW5kIHVzaW5nIHRoZSBmYWN0IHRoYXQgKHZmLXYwKSBlcXVhbHMgYXJlYSB1bmRlciBhY2NlbGVyYXRpb25cblx0YU1heCA9ICh2ZiAtIHYwKSAvICh0ZDEgKyB0ZG0pO1xuXHRqZXJrID0gYU1heCAvIHRkMTtcblxuXHRjb2VmZnMxID0gW2plcmsgLyA2LCAwLCB2MCwgcDBdO1xuXHRiYXNpY1NlZ21lbnQgPSBiYXNpY1NlZ21lbnRGYWN0b3J5LkNyZWF0ZUJhc2ljU2VnbWVudCh0MCwgdDAgKyB0ZDEsIGNvZWZmczEpO1xuXG5cdGNvZWZmczIgPSBbMCwgYU1heCAvIDIsIGJhc2ljU2VnbWVudC5ldmFsdWF0ZVZlbG9jaXR5QXQodDAgKyB0ZDEpLCBiYXNpY1NlZ21lbnQuZXZhbHVhdGVQb3NpdGlvbkF0KHQwICsgdGQxKV07IC8vIG1pZGRsZSBzZWdtZW50IGhhcyBubyBqZXJrXG5cblx0YmFzaWNTZWdtZW50MiA9IGJhc2ljU2VnbWVudEZhY3RvcnkuQ3JlYXRlQmFzaWNTZWdtZW50KHQwICsgdGQxLCB0MCArIHRkMSArIHRkbSwgY29lZmZzMik7XG5cblx0Y29lZmZzMyA9IFstamVyayAvIDYsIGFNYXggLyAyLCBiYXNpY1NlZ21lbnQyLmV2YWx1YXRlVmVsb2NpdHlBdCh0MCArIHRkMSArIHRkbSksIGJhc2ljU2VnbWVudDIuZXZhbHVhdGVQb3NpdGlvbkF0KHQwICsgdGQxICsgdGRtKV07XG5cdGJhc2ljU2VnbWVudDMgPSBiYXNpY1NlZ21lbnRGYWN0b3J5LkNyZWF0ZUJhc2ljU2VnbWVudCh0MCArIHRkMSArIHRkbSwgdGYsIGNvZWZmczMpO1xuXG5cblx0cmV0dXJuIFtiYXNpY1NlZ21lbnQsIGJhc2ljU2VnbWVudDIsIGJhc2ljU2VnbWVudDNdO1xufTtcblxuXG4vKipcbiAqIE1vZGlmaWVzIHNlZ21lbnQgaW5pdGlhbCB2YWx1ZXMuIFVzZWQgd2hlbiBhIHNlZ21lbnQgaW4gYSBwcm9maWxlIGlzIGNoYW5nZWQuXG4gKiBNb2RpZmljYXRpb24gdGFrZXMgaW50byBhY2NvdW50IGFic29sdXRlIHZzIGluY3JlbWVudGFsIG1vZGVcbiAqIEBwYXJhbSB7ZmxvYXR9IHQwIG5ldyBpbml0aWFsIHRpbWVcbiAqIEBwYXJhbSB7ZmxvYXR9IGEwIG5ldyBpbml0aWFsIGFjY2VsZXJhdGlvblxuICogQHBhcmFtIHtmbG9hdH0gdjAgbmV3IGluaXRpYWwgdmVsb2NpdHlcbiAqIEBwYXJhbSB7ZmxvYXR9IHAwIG5ldyBpbml0aWFsIHBvc2l0aW9uXG4gKi9cbkFjY2VsU2VnbWVudFRpbWVWZWxvY2l0eS5wcm90b3R5cGUubW9kaWZ5SW5pdGlhbFZhbHVlcyA9IGZ1bmN0aW9uKHQwLCBhMCwgdjAsIHAwKSB7XG5cblx0dmFyIHRmLCB2ZjtcblxuXHRpZiAodGhpcy5zZWdtZW50RGF0YS5tb2RlID09PSBcImluY3JlbWVudGFsXCIpIHtcblx0XHR0ZiA9IHQwICsgdGhpcy5zZWdtZW50RGF0YS5kdXJhdGlvbjtcblx0XHR2ZiA9IHYwICsgdGhpcy5zZWdtZW50RGF0YS5maW5hbFZlbG9jaXR5IC0gdGhpcy5zZWdtZW50RGF0YS5pbml0aWFsVmVsb2NpdHk7XG5cdH0gZWxzZSB7XG5cdFx0dGYgPSB0aGlzLnNlZ21lbnREYXRhLmZpbmFsVGltZTtcblx0XHR0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uID0gdGYgLSB0MDtcblx0XHR2ZiA9IHRoaXMuc2VnbWVudERhdGEuZmluYWxWZWxvY2l0eTtcblx0XHRpZiAoZmFzdE1hdGgubHQodGhpcy5zZWdtZW50RGF0YS5kdXJhdGlvbiwgMCkpXG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ3RyaWVkIHRvIG1vdmUgaW5pdGlhbCB0aW1lIHBhc3QgZmluYWwgdGltZSBmb3IgYWJzb2x1dGUgc2VnbWVudCcpO1xuXHR9XG5cblx0dmFyIG5ld0Jhc2ljU2VnbWVudHMgPSB0aGlzLmNhbGN1bGF0ZUJhc2ljU2VnbWVudHModDAsIHRmLCBwMCwgdjAsIHZmLCB0aGlzLnNlZ21lbnREYXRhLmplcmtQZXJjZW50KTtcblxuXHR0aGlzLmluaXRpYWxUaW1lID0gbmV3QmFzaWNTZWdtZW50c1swXS5pbml0aWFsVGltZTtcblx0dGhpcy5maW5hbFRpbWUgPSBuZXdCYXNpY1NlZ21lbnRzW25ld0Jhc2ljU2VnbWVudHMubGVuZ3RoIC0gMV0uZmluYWxUaW1lO1xuXG5cdHRoaXMuc2VnbWVudHMuaW5pdGlhbGl6ZVdpdGhTZWdtZW50cyhuZXdCYXNpY1NlZ21lbnRzKTtcblxuXHRyZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogRWRpdCB1c2VyIGVudGVyZWQgc2VnbWVudCB2YWx1ZXNcbiAqIEBwYXJhbSAge09iamVjdH0gbmV3U2VnbWVudERhdGEgICAgICBuZXcgdXNlciBlbnRlcmVkIGRhdGFcbiAqIEBwYXJhbSB7T2JqZWN0fSBpbml0aWFsQ29uZGl0aW9ucyBpbml0aWFsIGNvbmRpdGlvbnNcbiAqL1xuQWNjZWxTZWdtZW50VGltZVZlbG9jaXR5LnByb3RvdHlwZS5tb2RpZnlTZWdtZW50VmFsdWVzID0gZnVuY3Rpb24obmV3U2VnbWVudERhdGEsIGluaXRpYWxDb25kaXRpb25zKSB7XG5cblx0aWYgKG5ld1NlZ21lbnREYXRhLm1vZGUgIT09IFwiYWJzb2x1dGVcIilcblx0XHRuZXdTZWdtZW50RGF0YS5tb2RlID0gXCJpbmNyZW1lbnRhbFwiO1xuXG5cdHRoaXMuc2VnbWVudERhdGEubW9kZSA9IG5ld1NlZ21lbnREYXRhLm1vZGUgfHwgdGhpcy5zZWdtZW50RGF0YS5tb2RlO1xuXHR0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxWZWxvY2l0eSA9IG5ld1NlZ21lbnREYXRhLmluaXRpYWxWZWxvY2l0eSB8fCB0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxWZWxvY2l0eTtcblx0dGhpcy5zZWdtZW50RGF0YS5maW5hbFZlbG9jaXR5ID0gbmV3U2VnbWVudERhdGEuZmluYWxWZWxvY2l0eSB8fCB0aGlzLnNlZ21lbnREYXRhLmZpbmFsVmVsb2NpdHk7XG5cdHRoaXMuc2VnbWVudERhdGEuZHVyYXRpb24gPSBuZXdTZWdtZW50RGF0YS5kdXJhdGlvbiB8fCB0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uO1xuXHR0aGlzLnNlZ21lbnREYXRhLmplcmtQZXJjZW50ID0gbmV3U2VnbWVudERhdGEuamVya1BlcmNlbnQgfHwgdGhpcy5zZWdtZW50RGF0YS5qZXJrUGVyY2VudDtcblx0dGhpcy5zZWdtZW50RGF0YS5sb2FkcyA9IHt9O1xuXHRVdGlsLmV4dGVuZCh0aGlzLnNlZ21lbnREYXRhLmxvYWRzLCBuZXdTZWdtZW50RGF0YS5sb2Fkcyk7XG5cblx0dGhpcy5maW5hbFRpbWUgPSB0aGlzLmluaXRpYWxUaW1lICsgdGhpcy5zZWdtZW50RGF0YS5kdXJhdGlvbjtcblxuXHR2YXIgbmV3QmFzaWNTZWdtZW50cyA9IHRoaXMuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyh0aGlzLmluaXRpYWxUaW1lLFxuXHRcdHRoaXMuZmluYWxUaW1lLFxuXHRcdGluaXRpYWxDb25kaXRpb25zLnBvc2l0aW9uLFxuXHRcdGluaXRpYWxDb25kaXRpb25zLnZlbG9jaXR5LFxuXHRcdHRoaXMuc2VnbWVudERhdGEuZmluYWxWZWxvY2l0eSxcblx0XHR0aGlzLnNlZ21lbnREYXRhLmplcmtQZXJjZW50XG5cdCk7XG5cblx0dGhpcy5zZWdtZW50cy5pbml0aWFsaXplV2l0aFNlZ21lbnRzKG5ld0Jhc2ljU2VnbWVudHMpO1xuXG5cdHRoaXMuc2V0QmFzaWNTZWdtZW50TG9hZHMobmV3U2VnbWVudERhdGEubG9hZHMpO1xuXHRyZXR1cm4gdGhpcztcbn07XG5cblxuLyoqXG4gKiBBY2NlbGVyYXRpb24gc2VnbWVudCB0aGF0IGlzIGJhc2VkIG9uIHRpbWUgYW5kIGRpc3RhbmNlLlxuICogV2hlbiBpbml0aWFsIGNvbmRpdGlvbnMgY2hhbmdlLCBpdCBpcyByZWNhbGN1bGF0ZWQgc3VjaCB0aGF0IHRoZSBkdXJhdGlvbiBhbmQgZmluYWwgcG9zaXRpb24gc3RheSB0aGUgc2FtZVxuICogQHBhcmFtIHtOdW1iZXJ9IHQwICAgaW5pdGlhbCB0aW1lXG4gKiBAcGFyYW0ge051bWJlcn0gdGYgICBmaW5hbCB0aW1lXG4gKiBAcGFyYW0ge051bWJlcn0gcDAgICBpbml0aWFsIHBvc2l0aW9uXG4gKiBAcGFyYW0ge051bWJlcn0gdjAgICBpbml0aWFsIHZlbG9jaXR5XG4gKiBAcGFyYW0ge051bWJlcn0gcGYgICBmaW5hbCBwb3NpdGlvblxuICogQHBhcmFtIHtOdW1iZXJ9IGpQY3QgcGVyY2VudCBqZXJrXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZSBhYnNvbHV0ZSBvciBpbmNyZW1lbnRhbFxuICovXG52YXIgQWNjZWxTZWdtZW50VGltZURpc3RhbmNlID0gZnVuY3Rpb24odDAsIHRmLCBwMCwgdjAsIHBmLCBqUGN0LCBtb2RlLCBsb2Fkcykge1xuXHRpZiAoYXJndW1lbnRzLmxlbmd0aCA8PSA3KVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGF0IGxlYXN0IDcgYXJndW1lbnRzIGluIEFjY2VsU2VnbWVudFRpbWVEaXN0YW5jZSBjb25zdHJ1Y3RvclwiKTtcblxuXHRpZiAobW9kZSAhPT0gXCJhYnNvbHV0ZVwiKVxuXHRcdG1vZGUgPSBcImluY3JlbWVudGFsXCI7XG5cblxuXHR2YXIgbG9hZHNfY29weSA9IHt9O1xuXHRVdGlsLmV4dGVuZChsb2Fkc19jb3B5LCBsb2Fkcyk7XG5cblx0Ly9pbmNyZW1lbnRhbCBhbmQgYWJzb2x1dGUgc2VnbWVudHMgYXJlIGluc3RhbnRpYXRlZCB0aGUgc2FtZSB3YXlcblx0dGhpcy5zZWdtZW50RGF0YSA9IHtcblx0XHRkYXRhUGVybXV0YXRpb246IFwidGltZS1kaXN0YW5jZVwiLFxuXHRcdGZpbmFsUG9zaXRpb246IHBmLFxuXHRcdGZpbmFsVGltZTogdGYsXG5cdFx0ZGlzdGFuY2U6IHBmIC0gcDAsXG5cdFx0ZHVyYXRpb246IHRmIC0gdDAsXG5cdFx0bW9kZTogbW9kZSxcblx0XHRqZXJrUGVyY2VudDogalBjdCxcblx0XHRsb2FkczogbG9hZHNfY29weVxuXHR9O1xuXG5cdHZhciBiYXNpY1NlZ21lbnRzID0gdGhpcy5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzKHQwLCB0ZiwgcDAsIHYwLCBwZiwgalBjdCk7XG5cblx0QWNjZWxNb3Rpb25TZWdtZW50LmNhbGwodGhpcywgYmFzaWNTZWdtZW50cyk7XG5cdHRoaXMuc2V0QmFzaWNTZWdtZW50TG9hZHMobG9hZHMpO1xufTtcblxuQWNjZWxTZWdtZW50VGltZURpc3RhbmNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoQWNjZWxNb3Rpb25TZWdtZW50LnByb3RvdHlwZSk7XG5BY2NlbFNlZ21lbnRUaW1lRGlzdGFuY2UucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gQWNjZWxTZWdtZW50VGltZURpc3RhbmNlO1xuXG4vKipcbiAqIENhbGN1bGF0ZXMgYW5kIGNyZWF0ZXMgdGhlIDEgdG8gMyBiYXNpYyBzZWdtZW50cyB0aGF0IEFjY2VsU2VnbWVudCBjb25zaXN0cyBvZlxuICogQHBhcmFtICB7TnVtYmVyfSB0MCAgIGluaXRpYWwgdGltZVxuICogQHBhcmFtICB7TnVtYmVyfSB0ZiAgIGZpbmFsdCB0aW1lXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHAwICAgaW5pdGlhbCBwb3NpdGlvblxuICogQHBhcmFtICB7TnVtYmVyfSB2MCAgIGluaXRpYWwgdmVsb2NpdHlcbiAqIEBwYXJhbSAge051bWJlcn0gdmYgICBmaW5hbCB2ZWxvY2l0eVxuICogQHBhcmFtICB7TnVtYmVyfSBqUGN0IGplcmsgcGVyY2VudGFnZVxuICogQHJldHVybiB7QXJyYXl9ICAgICAgQXJyYXkgb2YgQmFzaWNTZWdtZW50XG4gKi9cbkFjY2VsU2VnbWVudFRpbWVEaXN0YW5jZS5wcm90b3R5cGUuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyA9IGZ1bmN0aW9uKHQwLCB0ZiwgcDAsIHYwLCBwZiwgalBjdCkge1xuXHR2YXIgYmFzaWNTZWdtZW50LCBiYXNpY1NlZ21lbnQyLCBiYXNpY1NlZ21lbnQzO1xuXHR2YXIgYWNjZWxTZWdtZW50LCBhTWF4O1xuXHR2YXIgY29lZmZzLCBjb2VmZnMxLCBjb2VmZnMyLCBjb2VmZnMzLCBjb2VmZnM0O1xuXHR2YXIgamVyaztcblx0dmFyIHRoO1xuXHRpZiAoalBjdCA9PT0gMCkge1xuXHRcdC8vIGNvbnNpc3RzIG9mIG9uZSBiYXNpYyBzZWdtZW50XG5cdFx0YU1heCA9ICgyICogKHBmIC0gcDApKSAvIGZhc3RNYXRoLnNxcih0ZiAtIHQwKTtcblx0XHRjb2VmZnMgPSBbMCwgMC41ICogYU1heCwgdjAsIHAwXTtcblxuXHRcdGJhc2ljU2VnbWVudCA9IGJhc2ljU2VnbWVudEZhY3RvcnkuQ3JlYXRlQmFzaWNTZWdtZW50KHQwLCB0ZiwgY29lZmZzKTtcblxuXHRcdHJldHVybiBbYmFzaWNTZWdtZW50XTtcblx0fVxuXG5cdC8vZnVuY3Rpb24gdG8gY2FsY3VsYXRlIG1heCBhY2NlbGVyYXRpb24gZm9yIHRoaXMgc2VnbWVudFxuXHR2YXIgbWF4QWNjZWwgPSBmdW5jdGlvbih2MCkge1xuXG5cdFx0dmFyIGR1cmF0aW9uID0gdGhpcy5zZWdtZW50RGF0YS5kdXJhdGlvbjtcblxuXHRcdHZhciB0MSA9IDAuNSAqIHRoaXMuc2VnbWVudERhdGEuamVya1BlcmNlbnQgKiAoZHVyYXRpb24pO1xuXHRcdHZhciB0bSA9IGR1cmF0aW9uIC0gMiAqICh0MSk7XG5cdFx0dmFyIHQyID0gdDE7IC8vbm8gc2tldyBmb3Igbm93XG5cblx0XHR2YXIgc3FyID0gZmFzdE1hdGguc3FyO1xuXG5cblx0XHR2YXIgbnVtZXJhdG9yID0gdGhpcy5zZWdtZW50RGF0YS5kaXN0YW5jZSAtIHYwICogKGR1cmF0aW9uKTtcblxuXHRcdHZhciBkZW5vbWluYXRvciA9IHNxcih0MSkgLyA2ICsgMC41ICogdDEgKiB0bSArIDAuNSAqIHNxcih0bSkgKyAwLjUgKiB0MSAqIHQyICsgdG0gKiB0MiArIHNxcih0MikgLyAzO1xuXG5cdFx0dmFyIGFNYXggPSBudW1lcmF0b3IgLyBkZW5vbWluYXRvcjtcblxuXHRcdHJldHVybiBhTWF4O1xuXG5cdH07XG5cblxuXHRhTWF4ID0gbWF4QWNjZWwuY2FsbCh0aGlzLCB2MCk7XG5cblx0aWYgKGpQY3QgPT0gMSkge1xuXHRcdC8vIHR3byBiYXNpYyBzZWdtZW50c1xuXG5cdFx0amVyayA9IGFNYXggLyB0aDtcblxuXHRcdGNvZWZmczEgPSBbamVyayAvIDYsIDAsIHYwLCBwMF07XG5cblx0XHRiYXNpY1NlZ21lbnQgPSBiYXNpY1NlZ21lbnRGYWN0b3J5LkNyZWF0ZUJhc2ljU2VnbWVudCh0MCwgdDAgKyB0aCwgY29lZmZzMSk7XG5cblx0XHRjb2VmZnMyID0gW2Jhc2ljU2VnbWVudC5ldmFsdWF0ZVBvc2l0aW9uQXQodDAgKyB0aCksIGJhc2ljU2VnbWVudC5ldmFsdWF0ZVZlbG9jaXR5QXQodDAgKyB0aCksIGFNYXggLyAyLCAtamVyayAvIDZdO1xuXG5cdFx0YmFzaWNTZWdtZW50MiA9IGJhc2ljU2VnbWVudEZhY3RvcnkuQ3JlYXRlQmFzaWNTZWdtZW50KHQwICsgdGgsIHRmLCBjb2VmZnMyKTtcblxuXHRcdHJldHVybiBbYmFzaWNTZWdtZW50LCBiYXNpY1NlZ21lbnQyXTtcblx0fVxuXG5cdC8vIGxhc3QgY2FzZSBpcyB0aHJlZSBiYXNpYyBzZWdtZW50c1xuXG5cdHZhciB0ZDE7IC8vZHVyYXRpb24gb2YgZmlyc3QgYW5kIHRoaXJkIHNlZ21lbnRzXG5cdHZhciB0ZG07IC8vZHVyYXRpb24gb2YgdGhlIG1pZGRsZSBzZWdtZW50XG5cdHRkMSA9IDAuNSAqIGpQY3QgKiAodGYgLSB0MCk7XG5cdHRkbSA9IHRmIC0gdDAgLSAyICogKHRkMSk7XG5cblx0amVyayA9IGFNYXggLyB0ZDE7XG5cblx0Y29lZmZzMSA9IFtqZXJrIC8gNiwgMCwgdjAsIHAwXTtcblx0YmFzaWNTZWdtZW50ID0gYmFzaWNTZWdtZW50RmFjdG9yeS5DcmVhdGVCYXNpY1NlZ21lbnQodDAsIHQwICsgdGQxLCBjb2VmZnMxKTtcblxuXHRjb2VmZnMyID0gWzAsIGFNYXggLyAyLCBiYXNpY1NlZ21lbnQuZXZhbHVhdGVWZWxvY2l0eUF0KHQwICsgdGQxKSwgYmFzaWNTZWdtZW50LmV2YWx1YXRlUG9zaXRpb25BdCh0MCArIHRkMSldOyAvLyBtaWRkbGUgc2VnbWVudCBoYXMgbm8gamVya1xuXHRiYXNpY1NlZ21lbnQyID0gYmFzaWNTZWdtZW50RmFjdG9yeS5DcmVhdGVCYXNpY1NlZ21lbnQodDAgKyB0ZDEsIHQwICsgdGQxICsgdGRtLCBjb2VmZnMyKTtcblxuXHRjb2VmZnMzID0gWy1qZXJrIC8gNiwgYU1heCAvIDIsIGJhc2ljU2VnbWVudDIuZXZhbHVhdGVWZWxvY2l0eUF0KHQwICsgdGQxICsgdGRtKSwgYmFzaWNTZWdtZW50Mi5ldmFsdWF0ZVBvc2l0aW9uQXQodDAgKyB0ZDEgKyB0ZG0pXTtcblx0YmFzaWNTZWdtZW50MyA9IGJhc2ljU2VnbWVudEZhY3RvcnkuQ3JlYXRlQmFzaWNTZWdtZW50KHQwICsgdGQxICsgdGRtLCB0ZiwgY29lZmZzMyk7XG5cblxuXHRyZXR1cm4gW2Jhc2ljU2VnbWVudCwgYmFzaWNTZWdtZW50MiwgYmFzaWNTZWdtZW50M107XG59O1xuXG5cbi8qKlxuICogTW9kaWZpZXMgc2VnbWVudCBpbml0aWFsIHZhbHVlcy4gVXNlZCB3aGVuIGFkZGluZyBhIHBvaW50IGluIHRoZSBtaWRkbGUgb2YgYSBzZWdtZW50LlxuICogQHBhcmFtIHtmbG9hdH0gdDAgbmV3IGluaXRpYWwgdGltZVxuICogQHBhcmFtIHtmbG9hdH0gYTAgbmV3IGluaXRpYWwgYWNjZWxlcmF0aW9uXG4gKiBAcGFyYW0ge2Zsb2F0fSB2MCBuZXcgaW5pdGlhbCB2ZWxvY2l0eVxuICogQHBhcmFtIHtmbG9hdH0gcDAgbmV3IGluaXRpYWwgcG9zaXRpb25cbiAqL1xuQWNjZWxTZWdtZW50VGltZURpc3RhbmNlLnByb3RvdHlwZS5tb2RpZnlJbml0aWFsVmFsdWVzID0gZnVuY3Rpb24odDAsIGEwLCB2MCwgcDApIHtcblxuXHR2YXIgdGYsIHBmO1xuXG5cdGlmICh0aGlzLnNlZ21lbnREYXRhLm1vZGUgPT09IFwiaW5jcmVtZW50YWxcIikge1xuXHRcdHRmID0gdDAgKyB0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uO1xuXHRcdHBmID0gcDAgKyB0aGlzLnNlZ21lbnREYXRhLmRpc3RhbmNlO1xuXHR9IGVsc2Uge1xuXHRcdC8vYWJzb2x1dGUgbW9kZVxuXHRcdHRmID0gdGhpcy5zZWdtZW50RGF0YS5maW5hbFRpbWU7XG5cdFx0dGhpcy5zZWdtZW50RGF0YS5kdXJhdGlvbiA9IHRmIC0gdDA7XG5cdFx0cGYgPSB0aGlzLnNlZ21lbnREYXRhLmZpbmFsUG9zaXRpb247XG5cdFx0dGhpcy5zZWdtZW50RGF0YS5kaXN0YW5jZSA9IHBmIC0gcDA7XG5cdFx0aWYgKGZhc3RNYXRoLmx0KHRoaXMuc2VnbWVudERhdGEuZHVyYXRpb24sIDApKVxuXHRcdFx0dGhyb3cgbmV3IEVycm9yKFwiYXR0ZW1wdCB0byBjaGFuZ2UgaW5pdGlhbCB0aW1lIHBhc3QgZmluYWwgdGltZSBmb3IgYWJzb2x1dGUgc2VnbWVudFwiKTtcblx0fVxuXG5cdHZhciBuZXdCYXNpY1NlZ21lbnRzID0gdGhpcy5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzKHQwLCB0ZiwgcDAsIHYwLCBwZiwgdGhpcy5zZWdtZW50RGF0YS5qZXJrUGVyY2VudCk7XG5cblx0dGhpcy5pbml0aWFsVGltZSA9IG5ld0Jhc2ljU2VnbWVudHNbMF0uaW5pdGlhbFRpbWU7XG5cdHRoaXMuZmluYWxUaW1lID0gbmV3QmFzaWNTZWdtZW50c1tuZXdCYXNpY1NlZ21lbnRzLmxlbmd0aCAtIDFdLmZpbmFsVGltZTtcblxuXHR0aGlzLnNlZ21lbnRzLmluaXRpYWxpemVXaXRoU2VnbWVudHMobmV3QmFzaWNTZWdtZW50cyk7XG5cblx0cmV0dXJuIHRoaXM7XG59O1xuXG5cbi8qKlxuICogRWRpdCB1c2VyIGVudGVyZWQgc2VnbWVudCB2YWx1ZXNcbiAqIEBwYXJhbSAge09iamVjdH0gbmV3U2VnbWVudERhdGEgICAgICBuZXcgdXNlciBlbnRlcmVkIGRhdGFcbiAqIEBwYXJhbSB7T2JqZWN0fSBpbml0aWFsQ29uZGl0aW9ucyBpbml0aWFsIGNvbmRpdGlvbnNcbiAqL1xuQWNjZWxTZWdtZW50VGltZURpc3RhbmNlLnByb3RvdHlwZS5tb2RpZnlTZWdtZW50VmFsdWVzID0gZnVuY3Rpb24obmV3U2VnbWVudERhdGEsIGluaXRpYWxDb25kaXRpb25zKSB7XG5cblxuXHRpZiAobmV3U2VnbWVudERhdGEubW9kZSAhPT0gXCJhYnNvbHV0ZVwiKVxuXHRcdG5ld1NlZ21lbnREYXRhLm1vZGUgPSBcImluY3JlbWVudGFsXCI7XG5cblxuXHR0aGlzLnNlZ21lbnREYXRhLm1vZGUgPSBuZXdTZWdtZW50RGF0YS5tb2RlIHx8IHRoaXMuc2VnbWVudERhdGEubW9kZTtcblx0dGhpcy5zZWdtZW50RGF0YS5kaXN0YW5jZSA9IG5ld1NlZ21lbnREYXRhLmRpc3RhbmNlIHx8IHRoaXMuc2VnbWVudERhdGEuZGlzdGFuY2U7XG5cdHRoaXMuc2VnbWVudERhdGEuZHVyYXRpb24gPSBuZXdTZWdtZW50RGF0YS5kdXJhdGlvbiB8fCB0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uO1xuXHR0aGlzLnNlZ21lbnREYXRhLmplcmtQZXJjZW50ID0gbmV3U2VnbWVudERhdGEuamVya1BlcmNlbnQgfHwgdGhpcy5zZWdtZW50RGF0YS5qZXJrUGVyY2VudDtcblxuXHR0aGlzLmZpbmFsVGltZSA9IHRoaXMuaW5pdGlhbFRpbWUgKyB0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uO1xuXG5cdHRoaXMuc2VnbWVudERhdGEubG9hZHMgPSB7fTtcblx0VXRpbC5leHRlbmQodGhpcy5zZWdtZW50RGF0YS5sb2FkcywgbmV3U2VnbWVudERhdGEubG9hZHMpO1xuXG5cdHZhciBuZXdCYXNpY1NlZ21lbnRzID0gdGhpcy5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzKHRoaXMuaW5pdGlhbFRpbWUsXG5cdFx0dGhpcy5maW5hbFRpbWUsXG5cdFx0aW5pdGlhbENvbmRpdGlvbnMucG9zaXRpb24sXG5cdFx0aW5pdGlhbENvbmRpdGlvbnMudmVsb2NpdHksXG5cdFx0aW5pdGlhbENvbmRpdGlvbnMucG9zaXRpb24gKyB0aGlzLnNlZ21lbnREYXRhLmRpc3RhbmNlLFxuXHRcdHRoaXMuc2VnbWVudERhdGEuamVya1BlcmNlbnRcblx0KTtcblxuXHR0aGlzLnNlZ21lbnRzLmluaXRpYWxpemVXaXRoU2VnbWVudHMobmV3QmFzaWNTZWdtZW50cyk7XG5cdHRoaXMuc2V0QmFzaWNTZWdtZW50TG9hZHMobmV3U2VnbWVudERhdGEubG9hZHMpO1xuXG5cdHJldHVybiB0aGlzO1xuXG5cbn07XG5cblxuXG4vKipcbiAqIE1ha2VzIGEgbmV3IEFjY2VsTW90aW9uU2VnbWVudCBnaXZlbiB2ZWxvY2l0eSBpbmZvcm1hdGlvblxuICogQHBhcmFtIHtudW1iZXJ9IHQwIFtpbml0aWFsIHRpbWVdXG4gKiBAcGFyYW0ge251bWJlcn0gdGYgW2ZpbmFsIHRpbWVdXG4gKiBAcGFyYW0ge251bWJlcn0gcDAgW2luaXRpYWwgcG9zaXRpb25dXG4gKiBAcGFyYW0ge251bWJlcn0gdjAgW2ZpbmFsIHBvc2l0aW9uXVxuICogQHBhcmFtIHtudW1iZXJ9IHZmIFtmaW5hbCB2ZWxvY2l0eV1cbiAqIEBwYXJhbSB7bnVtYmVyfSBqUGN0ICBbamVyayBhcyBhIHBlcmNlbnQgb2YgdGltZV1cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlIGluY3JlbWVudGFsIG9yIGFic29sdXRlXG4gKiBAcmV0dXJucyB7QWNjZWxNb3Rpb25TZWdtZW50fSBbZnJlc2hseSBjcmVhdGVkIGFjY2VsIHNlZ21lbnRdXG4gKi9cbmZhY3RvcnkuTWFrZUZyb21UaW1lVmVsb2NpdHkgPSBmdW5jdGlvbih0MCwgdGYsIHAwLCB2MCwgdmYsIGpQY3QsIG1vZGUsIGxvYWRzKSB7XG5cblx0aWYgKFV0aWwuaXNVbmRlZmluZWQoalBjdCkgfHwgalBjdCA8IDAgfHwgalBjdCA+IDEpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3RpbmcgamVyayBiZXR3ZWVuIDwwLDE+Jyk7XG5cblx0dmFyIGFjY2VsU2VnbWVudCA9IG5ldyBBY2NlbFNlZ21lbnRUaW1lVmVsb2NpdHkodDAsIHRmLCBwMCwgdjAsIHZmLCBqUGN0LCBtb2RlLCBsb2Fkcyk7XG5cblx0cmV0dXJuIGFjY2VsU2VnbWVudDtcblxufTtcblxuLyoqXG4gKiBNYWtlcyBhIG5ldyBBY2NlbE1vdGlvblNlZ21lbnQgZ2l2ZW4gdmVsb2NpdHkgaW5mb3JtYXRpb25cbiAqIEBwYXJhbSB7TnVtYmVyfSB0MCBbaW5pdGlhbCB0aW1lXVxuICogQHBhcmFtIHtOdW1iZXJ9IHRmIFtmaW5hbCB0aW1lXVxuICogQHBhcmFtIHtOdW1iZXJ9IHAwIFtpbml0aWFsIHBvc2l0aW9uXVxuICogQHBhcmFtIHtOdW1iZXJ9IHYwIFtmaW5hbCBwb3NpdGlvbl1cbiAqIEBwYXJhbSB7TnVtYmVyfSBwZiBmaW5hbCB2ZWxvY2l0eVxuICogQHBhcmFtIHtOdW1iZXJ9IGpQY3QgIFtqZXJrIGFzIGEgcGVyY2VudCBvZiB0aW1lXVxuICogQHJldHVybnMge0FjY2VsTW90aW9uU2VnbWVudH0gW2ZyZXNobHkgY3JlYXRlZCBhY2NlbCBzZWdtZW50XVxuICovXG5mYWN0b3J5Lk1ha2VGcm9tVGltZURpc3RhbmNlID0gZnVuY3Rpb24odDAsIHRmLCBwMCwgdjAsIHBmLCBqUGN0LCBtb2RlLCBsb2Fkcykge1xuXG5cdGlmIChVdGlsLmlzVW5kZWZpbmVkKGpQY3QpIHx8IGpQY3QgPCAwIHx8IGpQY3QgPiAxKVxuXHRcdHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIGplcmsgYmV0d2VlbiA8MCwxPicpO1xuXHQvL1RPRE86IG1vcmUgcGFyYW1ldGVyIGNoZWNrc1xuXG5cdHZhciBhY2NlbFNlZ21lbnQgPSBuZXcgQWNjZWxTZWdtZW50VGltZURpc3RhbmNlKHQwLCB0ZiwgcDAsIHYwLCBwZiwgalBjdCwgbW9kZSwgbG9hZHMpO1xuXG5cdHJldHVybiBhY2NlbFNlZ21lbnQ7XG5cblxufTtcblxuZmFjdG9yeS5jYWxjdWxhdGVUaW1lVmVsb2NpdHlCYXNpY1NlZ21lbnRzID0gQWNjZWxTZWdtZW50VGltZVZlbG9jaXR5LnByb3RvdHlwZS5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzO1xuXG5cbmZhY3RvcnkuQWNjZWxNb3Rpb25TZWdtZW50ID0gQWNjZWxNb3Rpb25TZWdtZW50O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZhY3Rvcnk7IiwidmFyIHBvbHlub21pYWxGYWN0b3J5ID0gcmVxdWlyZSgnLi4vdXRpbC9wb2x5bm9taWFsJyk7XG52YXIgTW90aW9uU2VnbWVudCA9IHJlcXVpcmUoJy4vbW90aW9uU2VnbWVudCcpO1xudmFyIEZhc3RNYXRoID0gcmVxdWlyZSgnLi4vdXRpbC9mYXN0TWF0aCcpO1xuXG4vKipcbiAqIGNvbnN0cnVjdG9yIGZvciBiYXNpYyBtb3Rpb24gc2VnbWVudFxuICogQHBhcmFtIHtpbnR9IHQwICAgICAgICAgICAgICAgICBpbml0aWFsIHRpbWVcbiAqIEBwYXJhbSB7aW50fSB0ZiAgICAgICAgICAgICAgICAgZmluYWwgdGltZVxuICogQHBhcmFtIHtBcnJheX0gcG9zaXRpb25Qb2x5Q29lZmZzIGFycmF5IG9mIHBvbHlub21pYWwgY29lZmZpY2llbnRzXG4gKiBAcGFyYW0ge09iamVjdH0gbG9hZHMgICAgICAgICAgICAgIGxvYWQgZGVmaW5pdGlvblxuICovXG52YXIgQmFzaWNNb3Rpb25TZWdtZW50ID0gZnVuY3Rpb24odDAsIHRmLCBwb3NpdGlvblBvbHlDb2VmZnMsIGxvYWRzKSB7XG5cblx0TW90aW9uU2VnbWVudC5Nb3Rpb25TZWdtZW50LmNhbGwodGhpcywgdDAsIHRmKTtcblxuXHR2YXIgcG9seSA9IG5ldyBwb2x5bm9taWFsRmFjdG9yeS5jcmVhdGVQb2x5QWJDZChwb3NpdGlvblBvbHlDb2VmZnMsIHQwLCB0Zik7XG5cblx0dGhpcy50eXBlID0gXCJiYXNpY1wiO1xuXG5cdHRoaXMucG9zaXRpb25Qb2x5ID0gcG9seTtcblxuXHR0aGlzLnZlbG9jaXR5UG9seSA9IHRoaXMucG9zaXRpb25Qb2x5LmRlcml2YXRpdmUoKTtcblx0dGhpcy5hY2NlbFBvbHkgPSB0aGlzLnZlbG9jaXR5UG9seS5kZXJpdmF0aXZlKCk7XG5cdHRoaXMuamVya1BvbHkgPSB0aGlzLmFjY2VsUG9seS5kZXJpdmF0aXZlKCk7XG5cblx0Ly9hZGQgdGhlIG5ld2x5IGNyZWF0ZWQgb2JqZWN0IHRvIHRoZSBzdGFzaC5cblx0Ly8gaW5zZXJ0aW9uIG5lZWRzIHRvIGhhcHBlbiBoZXJlLCBzbyB0aGUgc3Vic2VxdWVudCBldmFsdWF0ZSBtZXRob2RzIGNhbiBjb21wbGV0ZVxuXHR0aGlzLnNlZ21lbnRzLmluc2VydEF0KHRoaXMpO1xuXG5cblx0Ly93YWl0IHVudGlsIHBvbHlub21pYWxzIGFyZSBhc3NpZ25lZCwgdGhlbiBjYWxjdWxhdGUgaW5pdGlhbCBhbmQgZmluYWwgdmVsL3Bvc1xuXHR0aGlzLmluaXRpYWxWZWxvY2l0eSA9IHRoaXMuZXZhbHVhdGVWZWxvY2l0eUF0KHQwKTtcblx0dGhpcy5maW5hbFZlbG9jaXR5ID0gdGhpcy5ldmFsdWF0ZVZlbG9jaXR5QXQodGYpO1xuXG5cdHRoaXMuaW5pdGlhbFBvc2l0aW9uID0gdGhpcy5ldmFsdWF0ZVBvc2l0aW9uQXQodDApO1xuXHR0aGlzLmZpbmFsUG9zaXRpb24gPSB0aGlzLmV2YWx1YXRlUG9zaXRpb25BdCh0Zik7XG5cblx0aWYgKCFsb2Fkcykge1xuXHRcdC8vdGhydXN0IGlzIGV4dGVybmFsIGZvcmNlIG9yIHRvcnF1ZVxuXHRcdHRoaXMudGhydXN0ID0gMDtcblxuXHRcdC8vZnJpY3Rpb24gLSBlaXRoZXIgZnJpY3Rpb24gY29lZmZpY2llbnQgKGZvciBsaW5lYXIpIG9yIGZyaWN0aW9uIChmb3Igcm90YXJ5KVxuXHRcdHRoaXMuZnJpY3Rpb24gPSAwO1xuXG5cdFx0Ly9sb2FkIC0gZWl0aGVyIG1hc3Mgb3IgaW5lcnRpYVxuXHRcdHRoaXMubG9hZCA9IDA7XG5cdH0gZWxzZSB7XG5cdFx0dGhpcy50aHJ1c3QgPSBsb2Fkcy50aHJ1c3QgfHwgMDtcblx0XHR0aGlzLmZyaWN0aW9uID0gbG9hZHMuZnJpY3Rpb24gfHwgMDtcblx0XHR0aGlzLmxvYWQgPSBsb2Fkcy5sb2FkIHx8IDA7XG5cdH1cblxuXG5cbn07XG5cbkJhc2ljTW90aW9uU2VnbWVudC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudC5wcm90b3R5cGUpO1xuQmFzaWNNb3Rpb25TZWdtZW50LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEJhc2ljTW90aW9uU2VnbWVudDtcblxuXG52YXIgZmFjdG9yeSA9IHt9O1xuXG5mYWN0b3J5LkNyZWF0ZUJhc2ljU2VnbWVudCA9IGZ1bmN0aW9uKHQwLCB0ZiwgcG9zaXRpb25Qb2x5Q29lZmZzLCBsb2Fkcykge1xuXHRpZiAodGYgPD0gdDApXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdmaW5hbCB0aW1lIG11c3QgYmUgZ3JlYXRlciB0aGFuIGluaXRpYWwgdGltZScpO1xuXHRpZiAoIUFycmF5LmlzQXJyYXkocG9zaXRpb25Qb2x5Q29lZmZzKSB8fCBwb3NpdGlvblBvbHlDb2VmZnMubGVuZ3RoICE9IDQpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3RpbmcgYXJyYXkgb2YgbGVuZ3RoIDQnKTtcblxuXHR2YXIgc2VnbWVudCA9IG5ldyBCYXNpY01vdGlvblNlZ21lbnQodDAsIHRmLCBwb3NpdGlvblBvbHlDb2VmZnMsIGxvYWRzKTtcblxuXHRyZXR1cm4gc2VnbWVudDtcblxufTtcblxuZmFjdG9yeS5CYXNpY01vdGlvblNlZ21lbnQgPSBCYXNpY01vdGlvblNlZ21lbnQ7XG5cbm1vZHVsZS5leHBvcnRzID0gZmFjdG9yeTsiLCJ2YXIgTW90aW9uU2VnbWVudCA9IHJlcXVpcmUoJy4vbW90aW9uU2VnbWVudCcpO1xudmFyIEJhc2ljU2VnbWVudCA9IHJlcXVpcmUoJy4vYmFzaWNTZWdtZW50Jyk7XG52YXIgZmFzdE1hdGggPSByZXF1aXJlKCcuLi91dGlsL2Zhc3RNYXRoJyk7XG52YXIgVXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwvdXRpbCcpO1xuXG52YXIgbnVtZXJpYyA9IHJlcXVpcmUoJ251bWVyaWMnKTtcblxudmFyIGZhY3RvcnkgPSB7fTtcblxudmFyIEludGVycG9sYXRpb25FbnVtID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgXCJMSU5FQVJcIjogMCxcbiAgICBcIkNVQklDXCI6MVxufSk7XG5cblxuLyoqIERlc2NyaWJlcyBjYW0gZGF0YSB0YWJsZVxuVGhlIGV4cGVjdGF0aW9uIGlzIHRoYXQgdGhlIGZpcnN0IGl0ZW0gaW4gbWFzdGVyIGFuZCBzbGF2ZSBhcnJheSBpcyB0aGUgaW5pdGlhbCB0aW1lIGFuZCBpbml0aWFsIHBvc2l0aW9uIHJlc3AuXG4gKi9cbnZhciBDYW1UYWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFzdGVyPVtdO1xuICAgIHRoaXMuc2xhdmU9W107XG4gICAgdGhpcy5pbnRlcnBvbGF0aW9uPVtdO1xuICAgIHRoaXMuZmluYWxTbG9wZT0wO1xuICAgIHRoaXMuaW5pdGlhbFNsb3BlPTA7XG59O1xuXG5cbi8qKlxuICogVmFsaWRhdGVzIGRhdGEgaW4gdGhlIGNhbSB0YWJsZVxuICogQHJldHVybiB7W3R5cGVdfSBbZGVzY3JpcHRpb25dXG4gKi9cbkNhbVRhYmxlLnByb3RvdHlwZS52YWxpZGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIFxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0aGlzLm1hc3RlcikpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcImV4cGVjdGluZyBgbWFzdGVyYCBkYXRhIHRvIGJlIGFycmF5XCIpO1xuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRoaXMubWFzdGVyKSlcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0aW5nIGBzbGF2ZWAgZGF0YSB0byBiZSBhcnJheVwiKTtcblxuICAgIGlmICh0aGlzLm1hc3Rlci5sZW5ndGggIT0gdGhpcy5zbGF2ZS5sZW5ndGgpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGluZyBgbWFzdGVyYCBhbmQgYHNsYXZlYCB0byBoYXZlIHRoZSBzYW1lIGxlbmd0aFwiKTtcblxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRoaXMuaW50ZXJwb2xhdGlvbikpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGluZyBgaW50ZXJwb2xhdGlvbmAgdG8gYmUgYW4gYXJyYXlcIik7XG5cbiAgICBpZiAodGhpcy5pbnRlcnBvbGF0aW9uLmxlbmd0aCAhPSB0aGlzLm1hc3Rlci5sZW5ndGggLSAxKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RpbmcgYGludGVycG9sYXRpb25gIGxlbmd0aCB0byBiZSBvbmUgbGVzcyB0aGFuIGBtYXN0ZXJgIGxlbmd0aFwiKTtcblxuXG4gICAgaWYgKCF0aGlzLmludGVycG9sYXRpb24uZXZlcnkoZnVuY3Rpb24oZWwsIGlkeCwgYXJyYXkpIHtcblxuICAgICAgICAgICAgcmV0dXJuIGVsID09PSBJbnRlcnBvbGF0aW9uRW51bS5DVUJJQyB8fCBlbCA9PT0gSW50ZXJwb2xhdGlvbkVudW0uTElORUFSO1xuICAgICAgICB9KSlcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwib25seSAxIG9yIDAgaXMgYSB2YWxpZCBpbnRlcnBsb2F0aW9uIHR5cGVcIik7XG5cblxuICAgIGZvciAodmFyIGkgPSAxOyBpIDwgdGhpcy5tYXN0ZXIubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYoIU51bWJlci5pc0Zpbml0ZSh0aGlzLm1hc3RlcltpXSkpXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RpbmcgbWFzdGVyIHZhbHVlIGF0IHJvdyBcIitpK1wiIHRvIGJlIGZpbml0ZVwiKTtcbiAgICAgICAgaWYoIU51bWJlci5pc0Zpbml0ZSh0aGlzLm1hc3RlcltpLTFdKSlcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGluZyBtYXN0ZXIgdmFsdWUgYXQgcm93IFwiK2krXCIgdG8gYmUgZmluaXRlXCIpO1xuICAgICAgICBpZihmYXN0TWF0aC5sZXEodGhpcy5tYXN0ZXJbaV0sdGhpcy5tYXN0ZXJbaS0xXSkpXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RpbmcgbWFzdGVyIHZhbHVlcyB0byBiZSBzb3J0ZWQgYXNjZW5kaW5nXCIpO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuXG59O1xuXG5cblxuLyoqXG4gKiBDYW1Nb3Rpb25TZWdtZW50IC0gIGhhbmRsZXMgb3BlcmF0aW9ucyBvbiBjYW0gc2VnbWVudHNcbiAqIEBwYXJhbSB7bnVtYmVyfSBwcmV2VGltZSBwcmV2aW91cyBzZWdtZW50J3MgZmluYWwgdGltZVxuICogQHBhcmFtIHtudW1iZXJ9IHByZXZQb3NpdGlvbiBwcmV2aW91cyBzZWdtZW50J3MgZmluYWwgcG9zaXRpb25cbiAqIEBwYXJhbSB7bnVtYmVyfSBwcmV2VmVsb2NpdHkgcHJldmlvdXMgc2VnbWVudHMnIGZpbmFsIHZlbG9jaXR5XG4gKi9cbnZhciBDYW1Nb3Rpb25TZWdtZW50ID0gZnVuY3Rpb24ocHJldlRpbWUsIHByZXZQb3NpdGlvbiwgcHJldlZlbG9jaXR5LGxvYWRzKSB7XG5cbiAgICB2YXIgdDAgPSBwcmV2VGltZSB8fCAwO1xuICAgIHZhciBwMCA9IHByZXZQb3NpdGlvbiB8fCAwO1xuICAgIHZhciB2MCA9IHByZXZWZWxvY2l0eSB8fCAwO1xuXG4gICAgdmFyIHRmID0gdDAgKyAxOyAvLyBkZWZhdWx0IC0gYWRkIDEgc2Vjb25kIGp1c3QgbGlrZSBNQTdcblxuICAgIHZhciBwZiA9IHAwKzEgOyAvLyBNQTcgbGlrZVxuXG4gICAgTW90aW9uU2VnbWVudC5Nb3Rpb25TZWdtZW50LmNhbGwodGhpcywgdDAsIHRmKTtcblxuICAgIHRoaXMuc2VnbWVudERhdGE9bmV3IENhbVRhYmxlKCk7XG5cbiAgICBcbiAgICB0aGlzLnNlZ21lbnREYXRhLm1hc3Rlcj0gW3QwLHRmXTtcbiAgICB0aGlzLnNlZ21lbnREYXRhLnNsYXZlPVtwMCxwZl07XG4gICAgdGhpcy5zZWdtZW50RGF0YS5pbnRlcnBvbGF0aW9uPSBbSW50ZXJwb2xhdGlvbkVudW0uQ1VCSUNdO1xuICAgIHRoaXMuc2VnbWVudERhdGEuaW5pdGlhbFNsb3BlPSBwcmV2VmVsb2NpdHk7XG4gICAgdGhpcy5zZWdtZW50RGF0YS5maW5hbFNsb3BlID0gMDtcblxuXG4gICAgdGhpcy50eXBlID0gJ2NhbSc7XG5cbiAgICBpZighIGxvYWRzKSB7XG4gICAgICAgICAvL3RocnVzdCBpcyBleHRlcm5hbCBmb3JjZSBvciB0b3JxdWVcbiAgICAgICAgICAgIHRoaXMudGhydXN0ID0gMDtcblxuICAgICAgICAgICAgLy9mcmljdGlvbiAtIGVpdGhlciBmcmljdGlvbiBjb2VmZmljaWVudCAoZm9yIGxpbmVhcikgb3IgZnJpY3Rpb24gKGZvciByb3RhcnkpXG4gICAgICAgICAgICB0aGlzLmZyaWN0aW9uID0gMDtcblxuICAgICAgICAgICAgLy9sb2FkIC0gZWl0aGVyIG1hc3Mgb3IgaW5lcnRpYVxuICAgICAgICAgICAgdGhpcy5sb2FkID0gMDtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHRoaXMudGhydXN0ID0gbG9hZHMudGhydXN0IHx8IDA7XG4gICAgICAgIHRoaXMuZnJpY3Rpb24gPSBsb2Fkcy5mcmljdGlvbiB8fCAwO1xuICAgICAgICB0aGlzLmxvYWQgPSBsb2Fkcy5sb2FkIHx8IDA7XG4gICAgfVxuXG4gICAgdmFyIGJhc2ljU2VnbWVudHMgPSB0aGlzLmNhbGN1bGF0ZUJhc2ljU2VnbWVudHModGhpcy5zZWdtZW50RGF0YSk7XG5cbiAgICB0aGlzLnNlZ21lbnRzLmluaXRpYWxpemVXaXRoU2VnbWVudHMoYmFzaWNTZWdtZW50cyk7XG5cbn07XG5cblxuQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudC5wcm90b3R5cGUpO1xuQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBDYW1Nb3Rpb25TZWdtZW50O1xuXG5cbi8qKlxuICogQ2FsY3VsYXRlcyBsaW5lYXIgaW50ZXJwb2xhdGlvbiBmb3IgWCBhbmQgWSBwb2ludHNcbiAqIEBwYXJhbSB7YXJyYXl9IFggYXJyYXkgb2YgbWFzdGVyIHBvc2l0aW9uc1xuICogQHBhcmFtIHthcnJheX0gWSBhcnJheSBvZiBzbGF2ZSBwb3NpdGlvbnNcbiAqL1xuQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUuY2FsY3VsYXRlTGluZWFyID0gZnVuY3Rpb24oWCwgWSkge1xuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KFgpIHx8ICFBcnJheS5pc0FycmF5KFkpKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJYIGFuZCBZIG11c3QgYmUgYXJyYXlzXCIpO1xuXG4gICAgaWYgKFgubGVuZ3RoICE9IFkubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk1hdHJpY2VzIG11c3QgaGF2ZSB0aGUgc2FtZSBsZW5ndGhcIik7XG4gICAgfVxuXG4gICAgaWYgKFgubGVuZ3RoID09IDEpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBpbnRlcnBvbGF0ZSBhIHNpbmdsZSBwb2ludFwiKTtcblxuICAgIHZhciBBID0gW107XG5cbiAgICBmb3IgKHZhciBpID0gMTsgaSA8IFgubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHNsb3BlID0gKFlbaV0gLSBZW2kgLSAxXSkgLyAoWFtpXSAtIFhbaSAtIDFdKTtcbiAgICAgICAgdmFyIGljcHQgPSBZW2kgLSAxXTtcbiAgICAgICAgQVtpIC0gMV0gPSBbaWNwdCwgc2xvcGUsIDAsIDBdO1xuICAgIH1cblxuXG4gICAgcmV0dXJuIEE7XG5cbn07XG5cblxuLyoqXG4gKiBDYWxjdWxhdGVzIGNvZWZmaWNpZW50cyBmb3IgYW4gYXJyYXkgb2YgWCBhbmQgWSB2YWx1ZXMgdXNpbmcgY3ViaWMgc3BsaW5lc1xuICogQHBhcmFtIHtkb3VibGUgQXJyYXl9IFggIGFycmF5IG9mIFggdmFsdWVzXG4gKiBAcGFyYW0ge2RvdWJsZSBBcnJheX0gWSAgYXJyYXkgb2YgWSB2YWx1ZXNcbiAqIEBwYXJhbSB7ZG91YmxlfSBzMCBpbml0aWFsIHNsb3BlXG4gKiBAcGFyYW0ge2RvdWJsZX0gc2YgZmluYWwgc2xvcGVcbiAqL1xuQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUuY2FsY3VsYXRlQ3ViaWMgPSBmdW5jdGlvbihYLCBZLCBzMCwgc2YpIHtcblxuICAgIC8vLS0tLS08SU5QVVRTPi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgLy8gdmFyIHMwPTA7XG4gICAgLy8gdmFyIHNmPTA7XG5cbiAgICAvLyB2YXIgWCA9IFsxLDJdOyAgIC8vZGVmaW5lIFggcG9pbnRzXG4gICAgLy8gdmFyIFkgPSBbMiw0XTsgICAvL2RlZmluZSBZIHBvaW50c1xuICAgIC8vLS0tLS08L0lOUFVUUz4tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cblxuICAgIC8vIGRhdGEgY2hlY2tzXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KFgpIHx8ICFBcnJheS5pc0FycmF5KFkpKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJYIGFuZCBZIG11c3QgYmUgYXJyYXlzXCIpO1xuXG4gICAgaWYgKFgubGVuZ3RoICE9IFkubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk1hdHJpY2VzIG11c3QgaGF2ZSB0aGUgc2FtZSBsZW5ndGhcIik7XG4gICAgfVxuXG4gICAgaWYgKFgubGVuZ3RoID09IDEpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBpbnRlcnBvbGF0ZSBhIHNpbmdsZSBwb2ludFwiKTtcblxuICAgIC8qKlxuICAgICAqIFtBbSBwb3B1bGF0ZSBtYXRyaXggcm93XVxuICAgICAqIEBwYXJhbSB7aW50fSBtIFsxLCAyIG9yIDMgd2hpY2ggcm93IGVudHJ5IChlYWNoIG1hdHJpeCByb3cgaGFzIHRocmVlIGVudHJpZXNdXG4gICAgICogQHBhcmFtIHtpbnR9IHIgbWF0cml4IHJvd1xuICAgICAqIEBwYXJhbSB7YXJyYXl9IGggYXJyYXkgb2YgaHMgKG1hc3RlciBwb3NpdGlvbiBkaWZmZXJlbmNlcylcbiAgICAgKi9cbiAgICB2YXIgQW0gPSBmdW5jdGlvbihtLCByLCBoKSB7XG5cbiAgICAgICAgdmFyIGhTaXplID0gaC5sZW5ndGggKyAxO1xuICAgICAgICBpZiAociA+IGhTaXplKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicGFzc2VkIHJvdyBudW1iZXIgdG9vIGxhcmdlLlwiKTtcblxuICAgICAgICAvLyBqdWdnbGUgdGhlIGgncyBhIGJpdCBpbiBvcmRlciB0byBtYWtlIGhhbmRsZSBmaXJzdCBhbmQgbGFzdCByb3dcbiAgICAgICAgdmFyIHByZXZIID0gaFtyIC0gMV07XG4gICAgICAgIGlmICghISFwcmV2SClcbiAgICAgICAgICAgIHByZXZIID0gMDtcbiAgICAgICAgdmFyIHRoaXNIID0gaFtyXTtcbiAgICAgICAgaWYgKCEhIXRoaXNIKVxuICAgICAgICAgICAgdGhpc0ggPSAwO1xuXG5cbiAgICAgICAgc3dpdGNoIChtKSB7XG4gICAgICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByZXZIO1xuICAgICAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgICAgIHJldHVybiAyICogKHByZXZIICsgdGhpc0gpO1xuICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzSDtcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwib25seSAxLDIgb3IgMyBhcmUgdmFsaWQgdmFsdWVzIGZvciBtXCIpO1xuXG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgdmFyIEJtID0gZnVuY3Rpb24ociwgZCkge1xuICAgICAgICAvL2ZpcnN0IHJvdz9cbiAgICAgICAgaWYgKHIgPT09IDApXG4gICAgICAgICAgICByZXR1cm4gNiAqIChkWzBdIC0gczApO1xuXG4gICAgICAgIC8vbGFzdCByb3c/XG4gICAgICAgIGlmIChyID09IGQubGVuZ3RoKVxuICAgICAgICAgICAgcmV0dXJuIDYgKiAoc2YgLSBkW3IgLSAxXSk7XG5cbiAgICAgICAgLy9hbGwgb3RoZXIgcm93c1xuICAgICAgICByZXR1cm4gNiAqIChkW3JdIC0gZFtyIC0gMV0pO1xuICAgIH07XG5cbiAgICAvLyBkZWZpbmUgYW5kIGFzc2lnbiBoIGFuZCBzbG9wZXMgZFxuICAgIHZhciBoID0gW107XG4gICAgdmFyIGQgPSBbXTtcblxuICAgIGZvciAodmFyIGkgPSAxOyBpIDwgWC5sZW5ndGg7IGkrKykge1xuICAgICAgICBoW2kgLSAxXSA9IFhbaV0gLSBYW2kgLSAxXTtcbiAgICAgICAgZFtpIC0gMV0gPSAoWVtpXSAtIFlbaSAtIDFdKSAvIGhbaSAtIDFdO1xuICAgIH1cblxuICAgIC8vIG5lZWQgdG8gaGF2ZSBtYXRyaWNlcyBpbiBmb3JtIEFYPUIsIHRoZW4gY2FuIGRvXG4gICAgLy8gaW52KEEpKkI9WFxuXG4gICAgdmFyIHJvd3MgPSBYLmxlbmd0aDtcbiAgICB2YXIgY29scyA9IHJvd3M7XG5cbiAgICB2YXIgQSA9IFtdO1xuICAgIHZhciBCID0gW107XG4gICAgdmFyIEMgPSBbXTtcblxuXG4gICAgZm9yICh2YXIgcm93ID0gMDsgcm93IDwgcm93czsgcm93KyspIHtcbiAgICAgICAgLy9jcmVhdGUgYSBuZXcgcm93IGFuZCBmaWxsIHdpdGggemVyb2VzXG4gICAgICAgIEFbcm93XSA9IEFycmF5LmFwcGx5KG51bGwsIG5ldyBBcnJheShjb2xzKSkubWFwKE51bWJlci5wcm90b3R5cGUudmFsdWVPZiwgMCk7XG5cbiAgICAgICAgLy8gd2hpY2ggY29sdW1uIHRvIHN0YXJ0IGluXG4gICAgICAgIHZhciBzdGFydENvbCA9IHJvdyAtIDE7XG4gICAgICAgIHZhciBzdG9wQ29sID0gc3RhcnRDb2wgKyAyO1xuXG4gICAgICAgIC8vc3BlY2lhbCBjYXNlcyBmb3IgZmlyc3QgYW5kIGxhc3Qgcm93XG4gICAgICAgIGlmIChzdGFydENvbCA8IDApIHtcbiAgICAgICAgICAgIHN0b3BDb2wgPSAxO1xuICAgICAgICAgICAgc3RhcnRDb2wgPSAwO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHN0b3BDb2wgPiByb3dzIC0gMSlcbiAgICAgICAgICAgIHN0b3BDb2wgPSByb3dzIC0gMTtcblxuICAgICAgICBmb3IgKHZhciBjb2wgPSBzdGFydENvbDsgY29sIDw9IHN0b3BDb2w7IGNvbCsrKSB7XG4gICAgICAgICAgICBBW3Jvd11bY29sXSA9IEFtKGNvbCAtIHJvdyArIDIsIHJvdywgaCk7XG4gICAgICAgIH1cblxuICAgICAgICBCW3Jvd10gPSBbXTtcbiAgICAgICAgQltyb3ddWzBdID0gQm0ocm93LCBkKTtcblxuICAgIH1cblxuICAgIHZhciBBaW52ID0gbnVtZXJpYy5pbnYoQSk7XG4gICAgQyA9IG51bWVyaWMuZG90KEFpbnYsIEIpO1xuXG4gICAgLy9mbGF0dGVuIHJlc3VsdCBpbnRvIG9uZSBhcnJheSBta1xuICAgIHZhciBtayA9IFtdO1xuICAgIG1rID0gbWsuY29uY2F0LmFwcGx5KG1rLCBDKTtcblxuICAgIC8vY2FsY3VsYXRlIHRoZSByZXN0IG9mIGNvZWZmaWNpZW50c1xuICAgIHZhciBhYSA9IFtdO1xuICAgIHZhciBiYiA9IFtdO1xuICAgIHZhciBjYyA9IFtdO1xuICAgIHZhciBkZCA9IFtdO1xuICAgIHZhciByZXN1bHQgPSBbXTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBYLmxlbmd0aCAtIDE7IGkrKykge1xuICAgICAgICBhYVtpXSA9IFlbaV07XG4gICAgICAgIGJiW2ldID0gZFtpXSAtIChoW2ldIC8gNikgKiAoMiAqIG1rW2ldICsgbWtbaSArIDFdKTtcbiAgICAgICAgY2NbaV0gPSBta1tpXSAvIDI7XG4gICAgICAgIGRkW2ldID0gKG1rW2kgKyAxXSAtIG1rW2ldKSAvICg2ICogaFtpXSk7XG5cbiAgICAgICAgcmVzdWx0W2ldID0gW107XG4gICAgICAgIHJlc3VsdFtpXSA9IFthYVtpXSwgYmJbaV0sIGNjW2ldLCBkZFtpXV07XG4gICAgfVxuXG4gICAgcmV0dXJuIChyZXN1bHQpO1xufTtcblxuXG4vKipcbiAqIEdldHMgcGVydGluZW50YSBkYXRhIHRvIGJlIGFibGUgdG8gc2VyaWFsaXplL2Rlc2VyaWxpemUgc2VnbWVudFxuICogQHJldHVybiB7b2JqZWN0fSBkYXRhIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBzZWdtZW50XG4gKi9cbkNhbU1vdGlvblNlZ21lbnQucHJvdG90eXBlLmV4cG9ydERhdGEgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZGF0YU9iaiA9IHt9O1xuXG4gICAgVXRpbC5leHRlbmQoZGF0YU9iaiwgdGhpcy5zZWdtZW50RGF0YSk7XG4gICAgZGF0YU9iai5jb25zdHJ1Y3RvciA9IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICBkYXRhT2JqLnR5cGUgPSAnQ2FtTW90aW9uU2VnbWVudCc7XG5cbiAgICByZXR1cm4gZGF0YU9iajtcblxufTtcblxuXG4vKipcbiAqIERlc2VyaWFsaXplKGNyZWF0ZSkgQ2FtTW90aW9uU2VnbWVudCBmcm9tIGEganNvbiBzdHJpbmdcbiAqIEBwYXJhbSAge09iamVjdH0gZGF0YSBkYXRhIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBzZWdtZW50IChzZWUgZXhwb3J0RGF0YSgpKVxuICogQHJldHVybiB7Q2FtTW90aW9uU2VnbWVudH0gICAgICBbZGVzY3JpcHRpb25dXG4gKi9cbkNhbU1vdGlvblNlZ21lbnQucHJvdG90eXBlLmltcG9ydEZyb21EYXRhID0gZnVuY3Rpb24oZGF0YSkge1xuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwibm90IGltcGxlbWVudGVkIHlldFwiKTtcblxufTtcblxuXG4vKipcbiAqIE1vZGlmaWVzIHNlZ21lbnQgaW5pdGlhbCB2YWx1ZXMuIFVzZWQgd2hlbiBhIHNlZ21lbnQgaW4gYSBwcm9maWxlIGlzIGNoYW5nZWQuXG4gKiBAcGFyYW0ge251bWJlcn0gaW5pdGlhbFRpbWUgbmV3IGluaXRpYWwgdGltZVxuICogQHBhcmFtIHtudW1iZXJ9IGluaXRpYWxQb3NpdGlvbiBuZXcgaW5pdGlhbCBwb3NpdGlvblxuICogQHBhcmFtIHtudW1iZXJ9IGluaXRpYWxWZWxvY2l0eSBuZXcgaW5pdGlhbCB2ZWxvY2l0eSAoaW5pdGlhbCBzbG9wZSk7XG4gKi9cbkNhbU1vdGlvblNlZ21lbnQucHJvdG90eXBlLm1vZGlmeUluaXRpYWxWYWx1ZXMgPSBmdW5jdGlvbihpbml0aWFsVGltZSwgaW5pdGlhbEFjY2VsZXJhdGlvbiwgaW5pdGlhbFZlbG9jaXR5LGluaXRpYWxQb3NpdGlvbikge1xuICAgIGlmKGluaXRpYWxUaW1lIDwgMClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW5pdGlhbFRpbWUgPCB6ZXJvLiBDYW0gdGFibGUgbWFzdGVyIHZhbHVlcyBjYW4ndCBiZSBuZWdhdGl2ZVwiKTtcblxuICAgIHZhciB0aW1lRGVsdGEgPSBpbml0aWFsVGltZS10aGlzLnNlZ21lbnREYXRhLm1hc3RlclswXTtcbiAgICB2YXIgcG9zRGVsdGEgPWluaXRpYWxQb3NpdGlvbi10aGlzLnNlZ21lbnREYXRhLnNsYXZlWzBdO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnNlZ21lbnREYXRhLm1hc3Rlci5sZW5ndGg7IGkrKykge1xuICAgICAgICB0aGlzLnNlZ21lbnREYXRhLm1hc3RlcltpXSs9dGltZURlbHRhO1xuICAgICAgICB0aGlzLnNlZ21lbnREYXRhLnNsYXZlW2ldICs9cG9zRGVsdGE7XG4gICAgfVxuXG4gICAgdGhpcy5zZWdtZW50RGF0YS5pbml0aWFsU2xvcGU9aW5pdGlhbFZlbG9jaXR5O1xuXG4gICAgdmFyIGJhc2ljU2VnbWVudHMgPSB0aGlzLmNhbGN1bGF0ZUJhc2ljU2VnbWVudHModGhpcy5zZWdtZW50RGF0YSk7XG5cbiAgICB0aGlzLmluaXRpYWxUaW1lPXRoaXMuc2VnbWVudERhdGEubWFzdGVyWzBdO1xuICAgIHRoaXMuZmluYWxUaW1lPXRoaXMuc2VnbWVudERhdGEubWFzdGVyW3RoaXMuc2VnbWVudERhdGEubWFzdGVyLmxlbmd0aC0xXTtcblxuICAgIHRoaXMuc2VnbWVudHMuaW5pdGlhbGl6ZVdpdGhTZWdtZW50cyhiYXNpY1NlZ21lbnRzKTtcblxufTtcblxuLyoqXG4gKiBNb2RpZmllcyBjYW0gdmFsdXMgd2l0aCBuZXcgY2FtdGFibGUuXG4gKiBFeHBlY3RzIGNhbSB0YWJsZSBoYXMgYmVlbiBvZmZzZXQgYnkgaW5pdGlhbCB2YWx1ZXMgaW4gVUlcbiAqIEBwYXJhbSAge09iamVjdH0gY2FtRGF0YSBuZXcgY2FtIGRhdGFcbiAqL1xuQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUubW9kaWZ5U2VnbWVudFZhbHVlcyA9IGZ1bmN0aW9uKG5ld1NlZ21lbnREYXRhKSB7XG4gICAgXG4gICAgdmFyIGxvYWRzPW5ld1NlZ21lbnREYXRhLmxvYWRzO1xuICAgIHZhciBjYW1UYWJsZSA9IG5ld1NlZ21lbnREYXRhLmNhbVRhYmxlO1xuXG4gICAgdmFyIGZpblNsb3BlID0gY2FtVGFibGUuZmluYWxTbG9wZSB8fCAwO1xuICAgIGlmKGxvYWRzKVxuICAgIHtcbiAgICAgICAgdGhpcy5zZWdtZW50RGF0YS50aHJ1c3Q9bG9hZHMudGhydXN0O1xuICAgICAgICB0aGlzLnNlZ21lbnREYXRhLmxvYWQ9bG9hZHMubG9hZDtcbiAgICAgICAgdGhpcy5zZWdtZW50RGF0YS5mcmljdGlvbj1sb2Fkcy5mcmljdGlvbjtcbiAgICB9XG5cbiAgICB0aGlzLnNlZ21lbnREYXRhLm1hc3Rlcj1jYW1UYWJsZS5tYXN0ZXI7XG4gICAgdGhpcy5zZWdtZW50RGF0YS5zbGF2ZT1jYW1UYWJsZS5zbGF2ZTtcbiAgICB0aGlzLnNlZ21lbnREYXRhLmludGVycG9sYXRpb249Y2FtVGFibGUuaW50ZXJwb2xhdGlvbjtcbiAgICB0aGlzLnNlZ21lbnREYXRhLmZpbmFsU2xvcGU9ZmluU2xvcGU7XG5cbiAgICB2YXIgYmFzaWNTZWdtZW50cyA9IHRoaXMuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyh0aGlzLnNlZ21lbnREYXRhKTtcblxuICAgIHRoaXMuc2VnbWVudHMuaW5pdGlhbGl6ZVdpdGhTZWdtZW50cyhiYXNpY1NlZ21lbnRzKTtcbn07XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBiYXNpYyBzZWdtZW50cyBmcm9tIGEgQ2FtVGFibGVcbiAqIEBwYXJhbSAge0NhbVRhYmxlfSBjYW1UYWJsZSBjYW0gdGFibGUgZW50ZXJlZCBieSB0aGUgdXNlclxuICogQHJldHVybiB7QXJyYXl9ICAgICAgICAgIGFycmF5IG9mIG5ldyBiYXNpYyBzZWdtZW50c1xuICovXG5DYW1Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzID0gZnVuY3Rpb24oY2FtVGFibGUpIHtcblxuICAgIGlmKCEoY2FtVGFibGUgaW5zdGFuY2VvZiBDYW1UYWJsZSkpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGluZyBhIHZhbGlkIENhbVRhYmxlIG9iamVjdCBpbiBDYW1Nb3Rpb25TZWdtZW50LmNhbGN1bGF0ZUJhc2ljU2VnbWVudHNcIik7XG5cbiAgICB2YXIgbWFzdGVyPWNhbVRhYmxlLm1hc3RlcjtcbiAgICB2YXIgc2xhdmUgPSBjYW1UYWJsZS5zbGF2ZTtcbiAgICB2YXIgaW50ZXJwb2xhdGlvbiA9Y2FtVGFibGUuaW50ZXJwb2xhdGlvbjtcbiAgICB2YXIgaW5pdGlhbFNsb3BlPWNhbVRhYmxlLmluaXRpYWxTbG9wZTtcbiAgICB2YXIgZmluYWxTbG9wZSA9IGNhbVRhYmxlLmZpbmFsU2xvcGU7XG5cblxuICAgIHZhciByZXN1bHQgPSBbXTsgICAgLy91c2VkIHRvIHJldHVybiBjb2VmZmljaWVudHNcblxuICAgIHZhciBjdXJyZW50Um93ID0gMTtcbiAgICB2YXIgY3ViaWNTdGFydCA9IDA7XG4gICAgdmFyIGluaXRTbG9wZSA9IGluaXRpYWxTbG9wZTtcbiAgICB2YXIgZmluU2xvcGU7XG4gICAgdmFyIGN1YmljU2VncyxjdWJpY01hc3RlcnM7XG4gICAgdmFyIGNvZWZmczM7XG4gICAgdmFyIHNlZyxpO1xuICAgIHZhciBiYXNpY1NlZ21lbnRzPVtdO1xuXG4gICAgd2hpbGUgKGN1cnJlbnRSb3cgPD0gbWFzdGVyLmxlbmd0aCAtIDEpIHtcblxuICAgICAgICAvL3NraXAgY3ViaWMgc2VnbWVudHMgdW50aWwgdGhlcmUgaXMgYSBsaW5lYXIgb25lXG4gICAgICAgIGlmIChpbnRlcnBvbGF0aW9uW2N1cnJlbnRSb3cgLSAxXSA9PT0gMCkge1xuXG4gICAgICAgICAgICAvL2NhbGN1bGF0ZSB0aGUgbGluZWFyIHNlZ21lbnQgZmlyc3QsIGN1eiBuZWVkIGZpbmFsIHNsb3BlXG4gICAgICAgICAgICB2YXIgbGluUmVzID0gdGhpcy5jYWxjdWxhdGVMaW5lYXIobWFzdGVyLnNsaWNlKGN1cnJlbnRSb3cgLSAxLCBjdXJyZW50Um93ICsgMSksIHNsYXZlLnNsaWNlKGN1cnJlbnRSb3cgLSAxLCBjdXJyZW50Um93ICsgMSkpO1xuXG4gICAgICAgICAgICBmaW5TbG9wZSA9IGxpblJlc1swXVsxXTtcblxuICAgICAgICAgICAgLy9uZWVkIHRvIGNhbGN1bGF0ZSBhbGwgcHJldmlvdXMgY3ViaWMgcm93c1xuICAgICAgICAgICAgY3ViaWNTZWdzID0gY3VycmVudFJvdyAtIGN1YmljU3RhcnQ7XG5cbiAgICAgICAgICAgIGN1YmljTWFzdGVycz1tYXN0ZXIuc2xpY2UoY3ViaWNTdGFydCwgY3ViaWNTdGFydCArIGN1YmljU2Vncyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChjdWJpY1NlZ3MgPiAxKSB7XG4gICAgICAgICAgICAgICAgY29lZmZzMyA9IHRoaXMuY2FsY3VsYXRlQ3ViaWMoY3ViaWNNYXN0ZXJzLFxuICAgICAgICAgICAgICAgICAgICBzbGF2ZS5zbGljZShjdWJpY1N0YXJ0LCBjdWJpY1N0YXJ0ICsgY3ViaWNTZWdzKSxcbiAgICAgICAgICAgICAgICAgICAgaW5pdFNsb3BlLFxuICAgICAgICAgICAgICAgICAgICBmaW5TbG9wZSk7XG5cblxuICAgICAgICAgICAgICAgIC8vcmVzdWx0ID0gcmVzdWx0LmNvbmNhdChjb2VmZnMzKTtcblxuICAgICAgICAgICAgICAgIC8vY29lZmZzMyBpcyBhbiBhcnJheSBvZiBhcnJ5YXlzXG4gICAgICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IGNvZWZmczMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgc2VnID0gQmFzaWNTZWdtZW50LkNyZWF0ZUJhc2ljU2VnbWVudChjdWJpY01hc3RlcnNbaV0sY3ViaWNNYXN0ZXJzW2krMV0sY29lZmZzM1tpXS5yZXZlcnNlKCksXG4gICAgICAgICAgICAgICAgICAgICAgICB7dGhydXN0OnRoaXMudGhydXN0LCBsb2FkOiB0aGlzLmxvYWQsIGZyaWN0aW9uOnRoaXMuZnJpY3Rpb259KTtcbiAgICAgICAgICAgICAgICAgICAgYmFzaWNTZWdtZW50cy5wdXNoKHNlZyk7XG4gICAgICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICBpbml0U2xvcGUgPSBsaW5SZXNbMF1bMV07XG5cbiAgICAgICAgICAgIHNlZyA9IEJhc2ljU2VnbWVudC5DcmVhdGVCYXNpY1NlZ21lbnQobWFzdGVyW2N1cnJlbnRSb3ctMV0sbWFzdGVyW2N1cnJlbnRSb3ddLGxpblJlc1swXS5yZXZlcnNlKCksXG4gICAgICAgICAgICAgICAgICAgICAgICB7dGhydXN0OnRoaXMudGhydXN0LCBsb2FkOiB0aGlzLmxvYWQsIGZyaWN0aW9uOnRoaXMuZnJpY3Rpb259KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYmFzaWNTZWdtZW50cy5wdXNoKHNlZyk7XG4gICAgICAgICAgICAvL3Jlc3VsdCA9IHJlc3VsdC5jb25jYXQobGluUmVzKTtcbiAgICAgICAgICAgIGN1YmljU3RhcnQgPSBjdXJyZW50Um93O1xuICAgICAgICB9XG5cbiAgICAgICAgY3VycmVudFJvdysrO1xuICAgIH1cblxuXG4gICAgLy8gdGhlcmUgbWF5IGJlICdsZWZ0b3ZlcicgY3ViaWMgc2VnbWVudHNcbiAgICAvL2N1cnJlbnQgcm93IGlzIHBhc3NlZCB0aGUgbGFzdCByb3cgbm93LCBzbyBuZWVkIHRvIHN1YnRyYWN0IG9uZSB0byBnZXQgdG8gYWN0dWFsIG51bWJlciBvZiBzZWdtZW50c1xuICAgIGN1YmljU2VncyA9IGN1cnJlbnRSb3cgLSAxIC0gY3ViaWNTdGFydDtcblxuXG4gICAgY3ViaWNNYXN0ZXJzPW1hc3Rlci5zbGljZShjdWJpY1N0YXJ0LCBjdWJpY1N0YXJ0ICsgY3ViaWNTZWdzICsgMSk7XG4gICAgaWYgKGN1YmljU2VncyA+IDApIHtcbiAgICAgICAgY29lZmZzMyA9IHRoaXMuY2FsY3VsYXRlQ3ViaWMoY3ViaWNNYXN0ZXJzLFxuICAgICAgICAgICAgc2xhdmUuc2xpY2UoY3ViaWNTdGFydCwgY3ViaWNTdGFydCArIGN1YmljU2VncyArIDEpLFxuICAgICAgICAgICAgaW5pdFNsb3BlLFxuICAgICAgICAgICAgZmluYWxTbG9wZSk7XG5cbiAgICAgICAgLy9yZXN1bHQgPSByZXN1bHQuY29uY2F0KGNvZWZmczMpO1xuXG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBjb2VmZnMzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBzZWcgPSBCYXNpY1NlZ21lbnQuQ3JlYXRlQmFzaWNTZWdtZW50KGN1YmljTWFzdGVyc1tpXSxjdWJpY01hc3RlcnNbaSsxXSxjb2VmZnMzW2ldLnJldmVyc2UoKSxcbiAgICAgICAgICAgICAgICB7dGhydXN0OnRoaXMudGhydXN0LCBsb2FkOiB0aGlzLmxvYWQsIGZyaWN0aW9uOnRoaXMuZnJpY3Rpb259KTtcbiAgICAgICAgICAgIGJhc2ljU2VnbWVudHMucHVzaChzZWcpO1xuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICAvL3JldHVybiByZXN1bHQ7XG5cbiAgICByZXR1cm4gYmFzaWNTZWdtZW50czsgICAgXG5cbn07XG5cblxuXG5DYW1Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5leHBvcnREYXRhID0gZnVuY3Rpb24oKSB7XG5cbiAgICB2YXIgZGF0YU9iaj1Nb3Rpb25TZWdtZW50Lk1vdGlvblNlZ21lbnQucHJvdG90eXBlLmV4cG9ydERhdGEuY2FsbCh0aGlzKTtcbiAgICBkYXRhT2JqLnR5cGU9XCJDYW1Nb3Rpb25TZWdtZW50XCI7XG5cbiAgICByZXR1cm4gZGF0YU9iajtcbn07XG5cblxuQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUuaW1wb3J0RnJvbURhdGEgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgaWYoZGF0YS5jb25zdHJ1Y3Rvcj09XCJDYW1Nb3Rpb25TZWdtZW50XCIpIHtcbiAgICAgICAgdmFyIHByZXZUaW1lPWRhdGEubWFzdGVyWzBdO1xuICAgICAgICB2YXIgcHJldlBvc2l0aW9uPWRhdGEuc2xhdmVbMF07XG4gICAgICAgIHZhciBwcmV2VmVsb2NpdHkgPSBkYXRhLmluaXRpYWxTbG9wZTtcbiAgICAgICAgdmFyIGNhbVNlZyA9IG5ldyBDYW1Nb3Rpb25TZWdtZW50KHByZXZUaW1lLHByZXZQb3NpdGlvbixwcmV2VmVsb2NpdHkpO1xuXG4gICAgICAgIHJldHVybiBjYW1TZWc7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FtTW90aW9uU2VnbWVudCBpcyBleHBlY3RpbmcgdG8gaGF2ZSBlcG9ueW1vdXNseSBuYW1lZCBjb25zdHJ1Y3RvclwiKTtcbn07XG5cblxuXG5mYWN0b3J5LmNhbGN1bGF0ZUN1YmljID0gQ2FtTW90aW9uU2VnbWVudC5wcm90b3R5cGUuY2FsY3VsYXRlQ3ViaWM7XG5mYWN0b3J5LmNhbGN1bGF0ZUxpbmVhciA9IENhbU1vdGlvblNlZ21lbnQucHJvdG90eXBlLmNhbGN1bGF0ZUxpbmVhcjtcbmZhY3RvcnkuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyA9IENhbU1vdGlvblNlZ21lbnQucHJvdG90eXBlLmNhbGN1bGF0ZUJhc2ljU2VnbWVudHM7XG5mYWN0b3J5LkludGVycG9sYXRpb25FbnVtID0gSW50ZXJwb2xhdGlvbkVudW07XG5mYWN0b3J5LkNhbU1vdGlvblNlZ21lbnQgPSBDYW1Nb3Rpb25TZWdtZW50O1xuZmFjdG9yeS5DYW1UYWJsZT1DYW1UYWJsZTtcblxuLyoqXG4gKiBjcmVhdGVzIG5ldyAgY2FtIHNlZ21lbnQgdXNpbmcgZGVmYXVsdCB2YWx1ZXMgYWxhIE1BN1xuICogQHBhcmFtIHtudW1iZXdyfSBwcmV2VGltZSBwcmV2aW91cyBzZWdtZW50J3MgZmluYWwgdGltZVxuICogQHBhcmFtIHtudW1iZXJ9IHByZXZQb3NpdGlvbiBwcmV2aW91cyBzZWdtZW50J3MgZmluYWwgcG9zaXRpb25cbiAqIEBwYXJhbSB7bnVtYmVyfSBwcmV2VmVsb2NpdHkgcHJldmlvdXMgc2VnbWVudHMnIGZpbmFsIHZlbG9jaXR5XG4gKi9cbmZhY3RvcnkuY3JlYXRlQ2FtU2VnbWVudD1mdW5jdGlvbihwcmV2VGltZSwgcHJldlBvc2l0aW9uLCBwcmV2VmVsb2NpdHksbG9hZHMpe1xuICAgIHJldHVybiBuZXcgQ2FtTW90aW9uU2VnbWVudChwcmV2VGltZSxwcmV2UG9zaXRpb24scHJldlZlbG9jaXR5LGxvYWRzKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzPWZhY3Rvcnk7XG4iLCJ2YXIgTW90aW9uU2VnbWVudCA9IHJlcXVpcmUoJy4vbW90aW9uU2VnbWVudCcpO1xudmFyIGJhc2ljU2VnbWVudEZhY3RvcnkgPSByZXF1aXJlKCcuL2Jhc2ljU2VnbWVudCcpO1xudmFyIEFjY2VsU2VnbWVudCA9IHJlcXVpcmUoJy4vYWNjZWxTZWdtZW50Jyk7XG52YXIgZmFzdE1hdGggPSByZXF1aXJlKCcuLi91dGlsL2Zhc3RNYXRoJyk7XG52YXIgVXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwvdXRpbCcpO1xuXG52YXIgZmFjdG9yeSA9IHt9O1xuXG4vKipcbiAqIEluZGV4TW90aW9uIHNlZ21lbnQgY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7QXJyYXl9IGJhc2ljU2VnbWVudHMgW2FycmF5IG9mIGJhc2ljIHNlZ21lbnRzXVxuICovXG52YXIgSW5kZXhNb3Rpb25TZWdtZW50ID0gZnVuY3Rpb24oYmFzaWNTZWdtZW50cykge1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoYmFzaWNTZWdtZW50cykpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgYW4gYXJyYXkgcGFyYW1ldGVyJyk7XG5cdGlmIChiYXNpY1NlZ21lbnRzLmxlbmd0aCA8IDEgfHwgYmFzaWNTZWdtZW50cy5sZW5ndGggPiA3KVxuXHRcdHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIGFyYXkgbGVuZ3RoIHRvIGJlIGF0IGxlYXN0IG9uZSwgYnV0IGxlc3MgdGhhbiBvciBlcXVhbCB0byA3Jyk7XG5cblx0dmFyIHQwID0gYmFzaWNTZWdtZW50c1swXS5pbml0aWFsVGltZTtcblx0dmFyIHRmID0gYmFzaWNTZWdtZW50c1tiYXNpY1NlZ21lbnRzLmxlbmd0aCAtIDFdLmZpbmFsVGltZTtcblxuXHRNb3Rpb25TZWdtZW50Lk1vdGlvblNlZ21lbnQuY2FsbCh0aGlzLCB0MCwgdGYpO1xuXG5cdGZvciAodmFyIGkgPSAxOyBpIDwgYmFzaWNTZWdtZW50cy5sZW5ndGg7IGkrKykge1xuXHRcdGlmIChiYXNpY1NlZ21lbnRzW2ldLmZpbmFsVGltZSA8PSBiYXNpY1NlZ21lbnRzW2kgLSAxXS5maW5hbFRpbWUpIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcigndGltZSBtaXNtYXRjaCBpbiBpbmRleCBzZWdtZW50Jyk7XG5cdFx0fVxuXHR9XG5cblx0dGhpcy50eXBlID0gJ2luZGV4JztcblxuXHQvLyBlYWNoIHNlZ21lbnQgKHJlZ2FyZGxlc3Mgb2YgdHlwZSkgaGFzIGluaXRpYWxUaW1lIGFuZCBmaW5hbFRpbWVcblx0dGhpcy5pbml0aWFsVGltZSA9IGJhc2ljU2VnbWVudHNbMF0uaW5pdGlhbFRpbWU7XG5cdHRoaXMuZmluYWxUaW1lID0gYmFzaWNTZWdtZW50c1tiYXNpY1NlZ21lbnRzLmxlbmd0aCAtIDFdLmZpbmFsVGltZTtcblxuXHR0aGlzLnNlZ21lbnRzLmluaXRpYWxpemVXaXRoU2VnbWVudHMoYmFzaWNTZWdtZW50cyk7XG59O1xuXG5cbkluZGV4TW90aW9uU2VnbWVudC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudC5wcm90b3R5cGUpO1xuSW5kZXhNb3Rpb25TZWdtZW50LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEluZGV4TW90aW9uU2VnbWVudDtcblxuXG5JbmRleE1vdGlvblNlZ21lbnQucHJvdG90eXBlLmV4cG9ydERhdGEgPSBmdW5jdGlvbiAoKSB7XG5cdFxuXHR2YXIgZGF0YU9iaiA9IE1vdGlvblNlZ21lbnQuTW90aW9uU2VnbWVudC5wcm90b3R5cGUuZXhwb3J0RGF0YS5jYWxsKHRoaXMpO1xuXHRkYXRhT2JqLnR5cGUgPSAnSW5kZXhNb3Rpb25TZWdtZW50JztcblxuXHRyZXR1cm4gZGF0YU9iajtcbn07XG5cblxuSW5kZXhNb3Rpb25TZWdtZW50LnByb3RvdHlwZS5pbXBvcnRGcm9tRGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG5cdGlmIChkYXRhLmNvbnN0cnVjdG9yID09PSBcIkluZGV4U2VnbWVudFwiKSB7XG5cdFx0cmV0dXJuIG5ldyBJbmRleFNlZ21lbnQoXG5cdFx0XHRkYXRhLmluaXRpYWxUaW1lLCAvLyB0MFxuXHRcdFx0ZGF0YS5maW5hbFRpbWUsIC8vIHRmXG5cdFx0XHRkYXRhLmluaXRpYWxQb3NpdGlvbiwgLy8gcDBcblx0XHRcdGRhdGEuZmluYWxQb3NpdGlvbiwgLy8gcGZcblx0XHRcdGRhdGEuaW5pdGlhbFZlbG9jaXR5LCAvLyB2XG5cdFx0XHRkYXRhLnZlbExpbVBvcyxcblx0XHRcdGRhdGEudmVsTGltTmVnLFxuXHRcdFx0ZGF0YS5hY2NKZXJrLFxuXHRcdFx0ZGF0YS5kZWNKZXJrLFxuXHRcdFx0ZGF0YS54U2tldyxcblx0XHRcdGRhdGEueVNrZXcsXG5cdFx0XHRkYXRhLnNoYXBlLFxuXHRcdFx0ZGF0YS5tb2RlLFxuXHRcdFx0ZGF0YS5sb2Fkcyk7XG5cdH1cblxuXHR0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIEluZGV4U2VnbWVudCB0eXBlOiBcIiArIGRhdGEuY29uc3RydWN0b3IpO1xufTtcblxuXG5JbmRleE1vdGlvblNlZ21lbnQucHJvdG90eXBlLnNldEJhc2ljU2VnbWVudExvYWRzID0gZnVuY3Rpb24obG9hZHMpIHtcblx0aWYgKCFsb2Fkcylcblx0XHRyZXR1cm47XG5cdHZhciBzZWdtZW50cyA9IHRoaXMuZ2V0QWxsU2VnbWVudHMoKTtcblxuXHRmb3IgKHZhciBpID0gc2VnbWVudHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcblx0XHRzZWdtZW50c1tpXS5mcmljdGlvbiA9IGxvYWRzLmZyaWN0aW9uIHx8IDA7XG5cdFx0c2VnbWVudHNbaV0udGhydXN0ID0gbG9hZHMudGhydXN0IHx8IDA7XG5cdFx0c2VnbWVudHNbaV0ubG9hZCA9IGxvYWRzLmxvYWQgfHwgMDtcblx0fVxufTtcblxuXG52YXIgSW5kZXhTZWdtZW50ID0gZnVuY3Rpb24odDAsIHRmLCBwMCwgcGYsIHYsIHZlbExpbVBvcywgdmVsTGltTmVnLCBhY2NKZXJrLCBkZWNKZXJrLCB4U2tldywgeVNrZXcsIHNoYXBlLCBtb2RlLCBsb2Fkcykge1xuXG5cdGlmIChtb2RlICE9PSBcImFic29sdXRlXCIpXG5cdFx0bW9kZSA9IFwiaW5jcmVtZW50YWxcIjtcblxuXHR2YXIgbG9hZHNfY29weSA9IHt9O1xuXHRVdGlsLmV4dGVuZChsb2Fkc19jb3B5LCBsb2Fkcyk7XG5cblx0dGhpcy5zZWdtZW50RGF0YSA9IHtcblx0XHRpbml0aWFsVGltZTogdDAsXG5cdFx0ZmluYWxUaW1lOiB0Zixcblx0XHRkdXJhdGlvbjogdGYgLSB0MCxcblx0XHRpbml0aWFsVmVsb2NpdHk6IHYsXG5cdFx0ZmluYWxWZWxvY2l0eTogdixcblx0XHRpbml0aWFsUG9zaXRpb246IHAwLFxuXHRcdGZpbmFsUG9zaXRpb246IHBmLFxuXHRcdC8vIGRpc3RhbmNlOiBwZi1wMCxcblx0XHR2ZWxMaW1OZWc6IHZlbExpbU5lZyxcblx0XHR2ZWxMaW1Qb3M6IHZlbExpbVBvcyxcblx0XHRhY2NKZXJrOiBhY2NKZXJrLFxuXHRcdGRlY0plcms6IGRlY0plcmssXG5cdFx0eFNrZXc6IHhTa2V3LFxuXHRcdHlTa2V3OiB5U2tldyxcblx0XHRzaGFwZTogc2hhcGUsXG5cdFx0bW9kZTogbW9kZSxcblx0XHRsb2FkczogbG9hZHNfY29weVxuXHR9O1xuXG5cdHZhciBiYXNpY1NlZ21lbnRzID0gdGhpcy5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzKHQwLCB0ZiwgcDAsIHBmLCB2LCB2ZWxMaW1Qb3MsIHZlbExpbU5lZywgYWNjSmVyaywgZGVjSmVyaywgeFNrZXcsIHlTa2V3LCBzaGFwZSk7XG5cblx0SW5kZXhNb3Rpb25TZWdtZW50LmNhbGwodGhpcywgYmFzaWNTZWdtZW50cyk7XG5cdHRoaXMuc2V0QmFzaWNTZWdtZW50TG9hZHMobG9hZHNfY29weSk7XG59O1xuXG5cbkluZGV4U2VnbWVudC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEluZGV4TW90aW9uU2VnbWVudC5wcm90b3R5cGUpO1xuSW5kZXhTZWdtZW50LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEluZGV4U2VnbWVudDtcblxuXG4vKipcbiAqIENhbGN1bGF0ZXMgYW5kIGNyZWF0ZXMgdGhlIDEgdG8gNyBiYXNpYyBzZWdtZW50cyB0aGF0IEluZGV4U2VnbWVudCBjb25zaXN0cyBvZlxuICogQHBhcmFtICB7TnVtYmVyfSB0MCAgIFx0XHRbaW5pdGlhbCB0aW1lXVxuICogQHBhcmFtICB7TnVtYmVyfSB0ZiAgIFx0XHRbZmluYWx0IHRpbWVdXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHAwICAgXHRcdFtpbml0aWFsIHBvc2l0aW9uXVxuICogQHBhcmFtICB7TnVtYmVyfSBwZiAgIFx0XHRbZmluYWwgcG9zaXRpb25dXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHYgICAgXHRcdFtzdGFydCBhbmQgZW5kIHZlbG9jaXR5XVxuICogQHBhcmFtICB7TnVtYmVyfSB2ZWxMaW1Qb3MgXHRbcG9zaXRpdmUgdmVsb2NpdHkgbGltaXQgKG51bGwvSW5mIGlmIG5vdCBhcHBsaWNhYmxlKSA8MCxJbmY+XVxuICogQHBhcmFtICB7TnVtYmVyfSB2ZWxMaW1OZWdcdFtuZWdhdGl2ZSB2ZWxvY2l0eSBsaW1pdCAobnVsbC8tSW5mIGlmIG5vdCBhcHBsaWNhYmxlKSA8LUluZiwgMD5dXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGFjY0plcmsgXHRbcGVyY2VudCBqZXJrIGFwcGxpZWQgdG8gdGhlIGZpcnN0IHRyYXBlem9pZCA8MCwxPi4gVGhpcyB2YWx1ZSBhcHBsaWVzIHRvIHRoZSBmaXJzdCB0cmFwemVvaWQgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIG9yIG5vdCBpdCBpcyBhY2NlbCBvciBkZWNlbC5dXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGRlY0plcmsgICBcdFtwZXJjZW50IGplcmsgYXBwbGllZCB0byB0aGUgc2Vjb25kIHRyYXBlem9pZCA8MCwxPl1cbiAqIEBwYXJhbSAge051bWJlcn0geFNrZXdcdFx0W3RpbWUgc2tldyA8LTEsMT5dXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHlTa2V3IFx0XHRbdmVsb2NpdHkgc2tldyA8LTEsMT5dXG4gKiBAcGFyYW0gIHtTdHJpbmd9IHNoYXBlXHRcdFtzaGFwZSBvZiB0aGUgdmVsb2NpdHkgcHJvZmlsZSAoXCJ0cmFwZXpvaWRcIiwgXCJ0cmlhbmdsZVwiKV1cbiAqIEByZXR1cm4ge0FycmF5fVx0XHRcdFx0W0FycmF5IG9mIEJhc2ljU2VnbWVudF1cbiAqL1xuSW5kZXhTZWdtZW50LnByb3RvdHlwZS5jYWxjdWxhdGVCYXNpY1NlZ21lbnRzID0gZnVuY3Rpb24odDAsIHRmLCBwMCwgcGYsIHYsIHZlbExpbVBvcywgdmVsTGltTmVnLCBhY2NKZXJrLCBkZWNKZXJrLCB4U2tldywgeVNrZXcsIHNoYXBlKSB7XG5cblx0LyoqXG5cdCAqIHlza2V3IGFmZmVjdHMgdGhlIG1heGltdW0gdmVsb2NpdHkuIGxpbWl0aW5nIHRoZSBtYXhpbXVtIHZlbG9jaXR5IG9yIG1pbmltdW0gdmVsb2NpdHkgaXMgdGhlIHNhbWUgYXMgbW9kaWZ5aW5nIHRoZSB5c2tldy4gdmVsb2NpdHlcblx0ICogbGltaXRzIG92ZXJyaWRlIHRoZSB5c2tldyB2YWx1ZS5cblx0ICovXG5cdGlmIChzaGFwZSA9PSBcInRyaWFuZ2xlXCIpIHtcblx0XHR5U2tldyA9IDE7XG5cdH0gZWxzZSBpZiAoeVNrZXcgPT09IG51bGwpIHtcblx0XHR5U2tldyA9IDAuNTtcblx0fVxuXG5cdC8qKlxuXHQgKiB0aGUgeHNrZXcgZG9lcyBOT1QgYWZmZWN0IHRoZSBzaXplIG9mIHRoZSBjb2FzdCBzZWdtZW50LiBpdCBvbmx5IGFmZmVjdHMgaG93IHRoZSB0b3RhbCBhY2NlbGRlY2VsIHRpbWUgaXMgc3BsaXQgYmV0d2VlbiB0aGUgYWNjZWwgYW5kIGRlY2VsIGN1cnZlXG5cdCAqL1xuXHRpZiAoeFNrZXcgPT09IG51bGwpXG5cdFx0eFNrZXcgPSAwO1xuXG5cdHZhciBkcCA9IHBmIC0gcDA7XG5cdHZhciBkdCA9IHRmIC0gdDA7XG5cdC8vIHZhciBzID0gZHAvYWJzKGRwKTsgLy8gc2lnbiBvZiBwb3NpdGlvbiBjaGFuZ2Vcblx0dmFyIHZfYXZlID0gZHAgLyBkdCAtIHY7IC8vIGF2ZXJhZ2UgdmVsb2NpdHlcblx0dmFyIHZtYXggPSB2ICsgKDEgKyB5U2tldykgKiB2X2F2ZTsgLy8gbWF4IHZlbG9jaXR5XG5cblx0Ly8gaWYgY2FsY3VsYXRlZCB2bSBpcyBvdXRzaWRlIHZlbG9jaXR5IGJvdW5kcywgY29ycmVjdCB5U2tldyBhbmQgdm1heFxuXHRpZiAodmVsTGltUG9zICE9PSBudWxsICYmIHZtYXggPiB2ZWxMaW1Qb3MpIHtcblx0XHR5U2tldyA9ICh2ZWxMaW1Qb3MgLSB2KSAvIHZfYXZlIC0gMTtcblx0XHR2bWF4ID0gdmVsTGltUG9zO1xuXHRcdHRocm93IG5ldyBFcnJvcignTWF4aW11bSB2ZWxvY2l0eSBleGNlZWRzIHBvc2l0aXZlIHZlbG9jaXR5IGxpbWl0LiBDaGFuZ2luZyB5U2tldy4nKTsgLy8gdGhpcyBzaG91bGQgcHJvYmFibHkgYmUgY2hhbmdlZCB0byBhIHJlYWwgZXJyb3Ivd2FybmluZy5cblx0fSBlbHNlIGlmICh2ZWxMaW1OZWcgIT09IG51bGwgJiYgdm1heCA8IHZlbExpbU5lZykge1xuXHRcdHlTa2V3ID0gKHZlbExpbU5lZyAtIHYpIC8gdl9hdmUgLSAxO1xuXHRcdHZtYXggPSB2ZWxMaW1OZWc7XG5cdFx0dGhyb3cgbmV3IEVycm9yKCdNYXhpbXVtIHZlbG9jaXR5IGV4Y2VlZHMgbmVnYXRpdmUgdmVsb2NpdHkgbGltaXQuIENoYW5naW5nIHlTa2V3LicpO1xuXHR9XG5cblx0Ly8gd2UgbWF5IGhhdmUganVzdCB0aHJvd24geXNrZXcgb3V0IG9mIGJvdW5kc1xuXHRpZiAoeVNrZXcgPiAxIHx8IHlTa2V3IDwgMClcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ0NvbmZsaWN0IGJldHdlZW4geSBza2V3IGFuZCBtYXhpbXVtIHZlbG9jaXR5Jyk7XG5cblx0Ly8gYXBwbHkgeVNrZXdcblx0dmFyIG1vZGlmaWVkWVNrZXcgPSAxIC0gMSAvICgxICsgeVNrZXcpO1xuXHR2YXIgYWNjZGVjX3RpbWUgPSBtb2RpZmllZFlTa2V3ICogZHQgKiAyO1xuXHR2YXIgY29hc3RfdGltZSA9IGR0IC0gYWNjZGVjX3RpbWU7XG5cblx0Ly8gYXBwbHkgeFNrZXdcblx0dmFyIGFjY190aW1lID0gYWNjZGVjX3RpbWUgLyAyICogKDEgKyB4U2tldyk7XG5cdHZhciBkZWNfdGltZSA9IGR0IC0gYWNjX3RpbWUgLSBjb2FzdF90aW1lO1xuXG5cdHZhciBvdXRwdXRTZWdzID0gW107XG5cblx0Ly8gYWNjZWwgc2VnbWVudFxuXHR2YXIgbmV4dFBvc2l0aW9uO1xuXHRpZiAoYWNjX3RpbWUgPiAwKSB7XG5cdFx0b3V0cHV0U2VncyA9IFtdLmNvbmNhdChvdXRwdXRTZWdzLCBBY2NlbFNlZ21lbnQuY2FsY3VsYXRlVGltZVZlbG9jaXR5QmFzaWNTZWdtZW50cyh0MCwgdDAgKyBhY2NfdGltZSwgcDAsIHYsIHZtYXgsIGFjY0plcmspKTtcblx0XHRuZXh0UG9zaXRpb24gPSBvdXRwdXRTZWdzW291dHB1dFNlZ3MubGVuZ3RoIC0gMV0uZXZhbHVhdGVQb3NpdGlvbkF0KHQwICsgYWNjX3RpbWUpO1xuXHRcdC8vIGNvbnNvbGUubG9nKG5leHRQb3NpdGlvbik7XG5cdH0gZWxzZSB7XG5cdFx0bmV4dFBvc2l0aW9uID0gcDA7XG5cdH1cblxuXHQvLyB0aGVyZSBtYXkgYmUgYSBzaWduaWZpY2FudCBwcm9ibGVtIHdpdGggdGhpcyBjb2RlLiBXSGF0IGhhcHBlbnMgaWYgd2UgaGF2ZSBhIHRyaWFuZ2xlIGFuZCBqZXJrcyBtYXRjaD8/PyBUaGVyZSdzIG9ubHkgMyBzZWdtZW50cy5cblx0Ly8gVGhpcyBjb2RlIHByb2R1Y2VzIGZvdXIgdGhvdWdoLiBOZWVkIHRvIGNvbnNpZGVyIGlmIHRoaXMgaXMgZ29pbmcgdG8gYmUgYW4gaXNzdWUuIEkgZG9uJ3QgdGhpbmsgaXQgd2lsbCBiZSB0aG91Z2guIC1CcmlhbiBHLiBNYXIgMTYgMjAxN1xuXG5cdC8vIENyZWF0ZSBjb2FzdCBiYXNpYyBzZWdtZW50XG5cdGlmIChjb2FzdF90aW1lID4gMCkge1xuXHRcdG91dHB1dFNlZ3MgPSBbXS5jb25jYXQob3V0cHV0U2VncywgYmFzaWNTZWdtZW50RmFjdG9yeS5DcmVhdGVCYXNpY1NlZ21lbnQodDAgKyBhY2NfdGltZSwgdDAgKyBhY2NfdGltZSArIGNvYXN0X3RpbWUsIFswLCAwLCB2bWF4LCBuZXh0UG9zaXRpb25dKSk7XG5cdFx0bmV4dFBvc2l0aW9uID0gb3V0cHV0U2Vnc1tvdXRwdXRTZWdzLmxlbmd0aCAtIDFdLmV2YWx1YXRlUG9zaXRpb25BdCh0MCArIGFjY190aW1lICsgY29hc3RfdGltZSk7XG5cdH1cblxuXHQvLyBkZWNlbCBzZWdtZW50XG5cdG91dHB1dFNlZ3MgPSBbXS5jb25jYXQob3V0cHV0U2VncywgQWNjZWxTZWdtZW50LmNhbGN1bGF0ZVRpbWVWZWxvY2l0eUJhc2ljU2VnbWVudHModDAgKyBhY2NfdGltZSArIGNvYXN0X3RpbWUsIHRmLCBuZXh0UG9zaXRpb24sIHZtYXgsIHYsIGRlY0plcmspKTtcblxuXHRyZXR1cm4gb3V0cHV0U2Vncztcbn07XG5cblxuXG4vKipcbiAqIE1vZGlmaWVzIHNlZ21lbnQgaW5pdGlhbCB2YWx1ZXMuIFVzZWQgd2hlbiBhIHNlZ21lbnQgaW4gYSBwcm9maWxlIGlzIGNoYW5nZWQuXG4gKiBNb2RpZmljYXRpb24gdGFrZXMgaW50byBhY2NvdW50IGFic29sdXRlIHZzIGluY3JlbWVudGFsIG1vZGVcbiAqIEBwYXJhbSB7ZmxvYXR9IHQwIG5ldyBpbml0aWFsIHRpbWVcbiAqIEBwYXJhbSB7ZmxvYXR9IGEwIG5ldyBpbml0aWFsIGFjY2VsZXJhdGlvblxuICogQHBhcmFtIHtmbG9hdH0gdjAgbmV3IGluaXRpYWwgdmVsb2NpdHlcbiAqIEBwYXJhbSB7ZmxvYXR9IHAwIG5ldyBpbml0aWFsIHBvc2l0aW9uXG4gKi9cbkluZGV4U2VnbWVudC5wcm90b3R5cGUubW9kaWZ5SW5pdGlhbFZhbHVlcyA9IGZ1bmN0aW9uKHQwLCBhMCwgdjAsIHAwKSB7XG5cblx0dmFyIHRmO1xuXHR2YXIgcGY7XG5cdGlmICh0aGlzLnNlZ21lbnREYXRhLm1vZGUgPT09IFwiaW5jcmVtZW50YWxcIikge1xuXHRcdHRmID0gdDAgKyB0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uO1xuXHRcdHBmID0gcDAgKyB0aGlzLnNlZ21lbnREYXRhLmZpbmFsUG9zaXRpb24gLSB0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxQb3NpdGlvbjtcblx0fSBlbHNlIHtcblx0XHR0ZiA9IHRoaXMuc2VnbWVudERhdGEuZmluYWxUaW1lO1xuXHRcdHBmID0gdGhpcy5zZWdtZW50RGF0YS5maW5hbFBvc2l0aW9uO1xuXHRcdHRoaXMuc2VnbWVudERhdGEuZHVyYXRpb24gPSB0ZiAtIHQwO1xuXHRcdGlmIChmYXN0TWF0aC5sdCh0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uLCAwKSlcblx0XHRcdHRocm93IG5ldyBFcnJvcigndHJpZWQgdG8gbW92ZSBpbml0aWFsIHRpbWUgcGFzdCBmaW5hbCB0aW1lIGZvciBhYnNvbHV0ZSBzZWdtZW50Jyk7XG5cdH1cblxuXHR2YXIgbmV3QmFzaWNTZWdtZW50cyA9IHRoaXMuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyh0MCxcblx0XHR0Zixcblx0XHRwMCxcblx0XHRwZixcblx0XHR2MCxcblx0XHR0aGlzLnNlZ21lbnREYXRhLnZlbExpbVBvcyxcblx0XHR0aGlzLnNlZ21lbnREYXRhLnZlbExpbU5lZyxcblx0XHR0aGlzLnNlZ21lbnREYXRhLmFjY0plcmssXG5cdFx0dGhpcy5zZWdtZW50RGF0YS5kZWNKZXJrLFxuXHRcdHRoaXMuc2VnbWVudERhdGEueFNrZXcsXG5cdFx0dGhpcy5zZWdtZW50RGF0YS55U2tldyxcblx0XHR0aGlzLnNlZ21lbnREYXRhLnNoYXBlXG5cdCk7XG5cblx0dGhpcy5pbml0aWFsVGltZSA9IG5ld0Jhc2ljU2VnbWVudHNbMF0uaW5pdGlhbFRpbWU7XG5cdHRoaXMuZmluYWxUaW1lID0gbmV3QmFzaWNTZWdtZW50c1tuZXdCYXNpY1NlZ21lbnRzLmxlbmd0aCAtIDFdLmZpbmFsVGltZTtcblxuXHR0aGlzLnNlZ21lbnRzLmluaXRpYWxpemVXaXRoU2VnbWVudHMobmV3QmFzaWNTZWdtZW50cyk7XG5cblx0cmV0dXJuIHRoaXM7XG59O1xuXG5cbi8qKlxuICogRWRpdCB1c2VyIGVudGVyZWQgc2VnbWVudCB2YWx1ZXNcbiAqIEBwYXJhbSAge09iamVjdH0gbmV3U2VnbWVudERhdGEgICAgICBuZXcgdXNlciBlbnRlcmVkIGRhdGFcbiAqIEBwYXJhbSB7T2JqZWN0fSBpbml0aWFsQ29uZGl0aW9ucyBpbml0aWFsIGNvbmRpdGlvbnNcbiAqL1xuSW5kZXhTZWdtZW50LnByb3RvdHlwZS5tb2RpZnlTZWdtZW50VmFsdWVzID0gZnVuY3Rpb24obmV3U2VnbWVudERhdGEsIGluaXRpYWxDb25kaXRpb25zKSB7XG5cblx0aWYgKG5ld1NlZ21lbnREYXRhLm1vZGUgIT09IFwiYWJzb2x1dGVcIilcblx0XHRuZXdTZWdtZW50RGF0YS5tb2RlID0gXCJpbmNyZW1lbnRhbFwiO1xuXG5cdC8vIGNvbnNpZGVyIHJlcGxhY2luZyBhbGwgdGhpcyBqdW5rIHdpdGggXy5tZXJnZVdpdGhcblx0dGhpcy5zZWdtZW50RGF0YS5tb2RlID0gbmV3U2VnbWVudERhdGEubW9kZSB8fCB0aGlzLnNlZ21lbnREYXRhLm1vZGU7XG5cdHRoaXMuc2VnbWVudERhdGEuaW5pdGlhbFRpbWUgPSBpbml0aWFsQ29uZGl0aW9ucy50aW1lIHx8IHRoaXMuc2VnbWVudERhdGEuaW5pdGlhbFRpbWU7XG5cdHRoaXMuc2VnbWVudERhdGEuZmluYWxUaW1lID0gbmV3U2VnbWVudERhdGEuZmluYWxUaW1lIHx8IHRoaXMuc2VnbWVudERhdGEuZmluYWxUaW1lO1xuXHR0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxWZWxvY2l0eSA9IGluaXRpYWxDb25kaXRpb25zLnZlbG9jaXR5IHx8IHRoaXMuc2VnbWVudERhdGEuaW5pdGlhbFZlbG9jaXR5O1xuXHR0aGlzLnNlZ21lbnREYXRhLmZpbmFsVmVsb2NpdHkgPSBpbml0aWFsQ29uZGl0aW9ucy52ZWxvY2l0eSB8fCB0aGlzLnNlZ21lbnREYXRhLmZpbmFsVmVsb2NpdHk7XG5cdHRoaXMuc2VnbWVudERhdGEuaW5pdGlhbFBvc2l0aW9uID0gaW5pdGlhbENvbmRpdGlvbnMucG9zaXRpb24gfHwgdGhpcy5zZWdtZW50RGF0YS5pbml0aWFsUG9zaXRpb247XG5cdHRoaXMuc2VnbWVudERhdGEuZmluYWxQb3NpdGlvbiA9IG5ld1NlZ21lbnREYXRhLmZpbmFsUG9zaXRpb24gfHwgdGhpcy5zZWdtZW50RGF0YS5maW5hbFBvc2l0aW9uO1xuXHR0aGlzLnNlZ21lbnREYXRhLnZlbExpbU5lZyA9IG5ld1NlZ21lbnREYXRhLnZlbExpbU5lZyB8fCB0aGlzLnNlZ21lbnREYXRhLnZlbExpbU5lZztcblx0dGhpcy5zZWdtZW50RGF0YS52ZWxMaW1Qb3MgPSBuZXdTZWdtZW50RGF0YS52ZWxMaW1Qb3MgfHwgdGhpcy5zZWdtZW50RGF0YS52ZWxMaW1Qb3M7XG5cdHRoaXMuc2VnbWVudERhdGEuYWNjSmVyayA9IG5ld1NlZ21lbnREYXRhLmFjY0plcmsgfHwgdGhpcy5zZWdtZW50RGF0YS5hY2NKZXJrO1xuXHR0aGlzLnNlZ21lbnREYXRhLmRlY0plcmsgPSBuZXdTZWdtZW50RGF0YS5kZWNKZXJrIHx8IHRoaXMuc2VnbWVudERhdGEuZGVjSmVyaztcblx0dGhpcy5zZWdtZW50RGF0YS54U2tldyA9IG5ld1NlZ21lbnREYXRhLnhTa2V3IHx8IHRoaXMuc2VnbWVudERhdGEueFNrZXc7XG5cdHRoaXMuc2VnbWVudERhdGEueVNrZXcgPSBuZXdTZWdtZW50RGF0YS55U2tldyB8fCB0aGlzLnNlZ21lbnREYXRhLnlTa2V3O1xuXHR0aGlzLnNlZ21lbnREYXRhLnNoYXBlID0gbmV3U2VnbWVudERhdGEuc2hhcGUgfHwgdGhpcy5zZWdtZW50RGF0YS5zaGFwZTtcblxuXHR0aGlzLnNlZ21lbnREYXRhLmR1cmF0aW9uID0gdGhpcy5zZWdtZW50RGF0YS5maW5hbFRpbWUgLSB0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxUaW1lO1xuXHR0aGlzLnNlZ21lbnREYXRhLmxvYWRzID0ge307XG5cdFV0aWwuZXh0ZW5kKHRoaXMuc2VnbWVudERhdGEubG9hZHMsIG5ld1NlZ21lbnREYXRhLmxvYWRzKTtcblxuXHR2YXIgbmV3QmFzaWNTZWdtZW50cyA9IHRoaXMuY2FsY3VsYXRlQmFzaWNTZWdtZW50cyh0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxUaW1lLFxuXHRcdHRoaXMuc2VnbWVudERhdGEuZmluYWxUaW1lLFxuXHRcdHRoaXMuc2VnbWVudERhdGEuaW5pdGlhbFBvc2l0aW9uLFxuXHRcdHRoaXMuc2VnbWVudERhdGEuZmluYWxQb3NpdGlvbixcblx0XHR0aGlzLnNlZ21lbnREYXRhLmluaXRpYWxWZWxvY2l0eSxcblx0XHR0aGlzLnNlZ21lbnREYXRhLnZlbExpbVBvcyxcblx0XHR0aGlzLnNlZ21lbnREYXRhLnZlbExpbU5lZyxcblx0XHR0aGlzLnNlZ21lbnREYXRhLmFjY0plcmssXG5cdFx0dGhpcy5zZWdtZW50RGF0YS5kZWNKZXJrLFxuXHRcdHRoaXMuc2VnbWVudERhdGEueFNrZXcsXG5cdFx0dGhpcy5zZWdtZW50RGF0YS55U2tldyxcblx0XHR0aGlzLnNlZ21lbnREYXRhLnNoYXBlXG5cdCk7XG5cblx0dGhpcy5zZWdtZW50cy5pbml0aWFsaXplV2l0aFNlZ21lbnRzKG5ld0Jhc2ljU2VnbWVudHMpO1xuXHR0aGlzLnNldEJhc2ljU2VnbWVudExvYWRzKG5ld1NlZ21lbnREYXRhLmxvYWRzKTtcblxuXHRyZXR1cm4gdGhpcztcbn07XG5cblxuLyoqXG4gKiBNYWtlcyBhIG5ldyBJbmRleE1vdGlvblNlZ21lbnQgZ2l2ZW4gdmVsb2NpdHkgaW5mb3JtYXRpb25cbiAqIEBwYXJhbSB7TnVtYmVyfSB0MCBcdFx0XHRcdFtpbml0aWFsIHRpbWVdXG4gKiBAcGFyYW0ge051bWJlcn0gdGYgXHRcdFx0XHRbZmluYWwgdGltZV1cbiAqIEBwYXJhbSB7TnVtYmVyfSBwMCBcdFx0XHRcdFtpbml0aWFsIHBvc2l0aW9uXVxuICogQHBhcmFtIHtOdW1iZXJ9IHBmIFx0XHRcdFx0W2ZpbmFsIHBvc2l0aW9uXVxuICogQHBhcmFtIHtOdW1iZXJ9IHYgXHRcdFx0XHRbaW5pdGlhbC9maW5hbCB2ZWxvY2l0eV1cbiAqIEBwYXJhbSB7TnVtYmVyfSB2ZWxMaW1Qb3NcdFx0W3Bvc2l0aXZlIHZlbG9jaXR5IGxpbWl0XVxuICogQHBhcmFtIHtOdW1iZXJ9IHZlbExpbU5lZ1x0XHRbbmVnYXRpdmUgdmVsb2NpdHkgbGltaXRdXG4gKiBAcGFyYW0ge051bWJlcn0gYWNjSmVya1x0XHRcdFthY2MgY3VydmUgamVyayBwZXJjZW50XVxuICogQHBhcmFtIHtOdW1iZXJ9IGRlY0plcmtcdFx0XHRbZGVjIGN1cnZlIGplcmsgcGVyY2VudF1cbiAqIEBwYXJhbSB7TnVtYmVyfSB4U2tld1x0XHRcdFt4IHNrZXcgdmFsdWUgPC0xLDE+XVxuICogQHBhcmFtIHtOdW1iZXJ9IHlTa2V3XHRcdFx0W3kgc2tldyB2YWx1ZSA8MCwxPl1cbiAqIEBwYXJhbSB7c3RyaW5nfSBzaGFwZVx0XHRcdFt0cmlhbmdsZSBvciB0cmFwZXpvaWRdXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZVx0XHRcdFx0W2luY3JlbWVudGFsIG9yIGFic29sdXRlXVxuICogQHJldHVybnMge0luZGV4TW90aW9uU2VnbWVudH1cdFtmcmVzaGx5IGNyZWF0ZWQgaW5kZXggc2VnbWVudF1cbiAqL1xuZmFjdG9yeS5NYWtlID0gZnVuY3Rpb24odDAsIHRmLCBwMCwgcGYsIHYsIHZlbExpbVBvcywgdmVsTGltTmVnLCBhY2NKZXJrLCBkZWNKZXJrLCB4U2tldywgeVNrZXcsIHNoYXBlLCBtb2RlLCBsb2Fkcykge1xuXHQvLyBkYXRhIHZhbGlkYXRpb25cblx0aWYgKFV0aWwuaXNVbmRlZmluZWQoYWNjSmVyaykgfHwgYWNjSmVyayA8IDAgfHwgYWNjSmVyayA+IDEpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3RpbmcgYWNjZWwgamVyayBiZXR3ZWVuIDwwLDE+Jyk7XG5cblx0aWYgKFV0aWwuaXNVbmRlZmluZWQoZGVjSmVyaykgfHwgZGVjSmVyayA8IDAgfHwgZGVjSmVyayA+IDEpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3RpbmcgZGVjZWwgamVyayBiZXR3ZWVuIDwwLDE+Jyk7XG5cblx0aWYgKHhTa2V3IDwgLTEgfHwgeFNrZXcgPiAxKVxuXHRcdHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIHhTa2V3IGJldHdlZW4gPC0xLDE+Jyk7XG5cblx0aWYgKHlTa2V3IDwgMCB8fCB5U2tldyA+IDEpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdleHBlY3RpbmcgeVNrZXcgYmV0d2VlbiA8MCwxPicpO1xuXG5cdGlmICh0ZiA8IHQwKVxuXHRcdHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIHRmIHRvIGNvbWUgYWZ0ZXIgdDAnKTtcblxuXHRpZiAoKHBmIC0gcDApIDwgMClcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ2V4cGVjdGluZyBub256ZXJvIHBvc2l0aW9uIGNoYW5nZScpO1xuXG5cdGlmIChVdGlsLmlzVW5kZWZpbmVkKHZlbExpbVBvcykgJiYgdmVsTGltUG9zID4gdilcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ2V4cGVjdGluZyBwb3NpdGl2ZSB2ZWxvY2l0eSBsaW1pdCB0byBiZSBncmVhdGVyIHRoYW4gdiBvciBudWxsJyk7XG5cblx0aWYgKFV0aWwuaXNVbmRlZmluZWQodmVsTGltTmVnKSAmJiB2ZWxMaW1OZWcgPCB2KVxuXHRcdHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIHBvc2l0aXZlIHZlbG9jaXR5IGxpbWl0IHRvIGJlIGdyZWF0ZXIgdGhhbiB2IG9yIG51bGwnKTtcblxuXHR2YXIgaW5kZXhTZWdtZW50ID0gbmV3IEluZGV4U2VnbWVudCh0MCwgdGYsIHAwLCBwZiwgdiwgdmVsTGltUG9zLCB2ZWxMaW1OZWcsIGFjY0plcmssIGRlY0plcmssIHhTa2V3LCB5U2tldywgc2hhcGUsIG1vZGUsIGxvYWRzKTtcblxuXHRyZXR1cm4gaW5kZXhTZWdtZW50O1xufTtcblxuXG5mYWN0b3J5LkluZGV4TW90aW9uU2VnbWVudCA9IEluZGV4TW90aW9uU2VnbWVudDtcblxubW9kdWxlLmV4cG9ydHM9ZmFjdG9yeTsiLCJ2YXIgZmFzdE1hdGggPSByZXF1aXJlKCcuLi91dGlsL2Zhc3RNYXRoJyk7XG52YXIgcG9seW5vbWlhbEZhY3RvcnkgPSByZXF1aXJlKCcuLi91dGlsL3BvbHlub21pYWwnKTtcbnZhciBTZWdtZW50ID0gcmVxdWlyZSgnLi9zZWdtZW50Jyk7XG52YXIgVXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwvdXRpbCcpO1xuXG52YXIgTGluZWFyTG9hZHNFbnVtID0gT2JqZWN0LmZyZWV6ZSh7XG5cdFwiRlJJQ1RJT05fQ09FRkZcIjogMSxcblx0XCJNQVNTXCI6IDIsXG5cdFwiRk9SQ0VcIjogM1xufSk7XG52YXIgUm90YXJ5TG9hZHNFbnVtID0gT2JqZWN0LmZyZWV6ZSh7XG5cdFwiRlJJQ1RJT05cIjogMSxcblx0XCJJTkVSVElBXCI6IDIsXG5cdFwiRVhURVJOQUxfVE9SUVVFXCI6IDNcbn0pO1xuXG4vKipcbiAqIExvYWRTZWdtZW50IGRlZmluZXMgbG9hZCB3aXRoIHJlc3BlY3QgdG8gdGltZS5cbiAqIGxvYWRzIGNhbiBvbmx5IGJlIGxpbmVzLCBpZSBmaXJzdCBkZWdyZWUgcG9seW5vbWlhbHNcbiAqIEBwYXJhbSB7TnVtYmVyfSB0MCBpbml0aWFsIFRpbWVcbiAqIEBwYXJhbSB7TnVtYmVyfSB0ZiBmaW5hbCBUaW1lXG4gKiBAcGFyYW0ge051bWJlcn0gaW5pdFZhbCBpbml0aWFsIGxvYWQgdmFsdWVcbiAqIEBwYXJhbSB7TnVtYmVyfSBmaW5hbFZhbCBmaW5hbCBsb2FkIHZhbHVlXG4gKi9cbnZhciBMb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHR5cGUsIHQwLCB0ZiwgaW5pdFZhbCwgZmluYWxWYWwpIHtcblxuXG5cdFNlZ21lbnQuU2VnbWVudC5jYWxsKHRoaXMsIHQwLCB0Zik7XG5cblxuXHR0aGlzLnNlZ21lbnREYXRhPSB7XG5cdFx0aW5pdGlhbFRpbWU6IHQwLFxuXHRcdGZpbmFsVGltZTogdGYsXG5cdFx0aW5pdGlhbFZhbHVlOiBpbml0VmFsLFxuXHRcdGZpbmFsVmFsdWU6IGZpbmFsVmFsLFxuXHRcdGxvYWRUeXBlOiB0eXBlXG5cblx0fTtcblxuXG5cdHZhciBzbG9wZSA9IChmaW5hbFZhbCAtIGluaXRWYWwpIC8gKHRmIC0gdDApO1xuXHR2YXIgaVNlY3QgPSBpbml0VmFsIC0gc2xvcGUgKiB0MCArIHNsb3BlICogdDA7XG5cblx0dGhpcy5sb2FkUG9seSA9IHBvbHlub21pYWxGYWN0b3J5LmNyZWF0ZVBvbHlBYkNkKFswLCAwLCBzbG9wZSwgaVNlY3RdLCB0MCwgdGYpO1xuXG5cbn07XG5cblxuTG9hZFNlZ21lbnQucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShTZWdtZW50LlNlZ21lbnQucHJvdG90eXBlKTtcbkxvYWRTZWdtZW50LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IExvYWRTZWdtZW50O1xuXG5cblxuTG9hZFNlZ21lbnQucHJvdG90eXBlLmV2YWx1YXRlTG9hZEF0ID0gZnVuY3Rpb24oeCkge1xuXHRyZXR1cm4gdGhpcy5sb2FkUG9seS5ldmFsdWF0ZUF0KHgpO1xufTtcblxuXG4vKipcbiAqIFJlY29uc3RydWN0IGxvYWQgc2VnbWVudCBmcm9tIGRhdGEgcmVwcmVzZW50YXRpb25cbiAqIEBwYXJhbSAge09iamVjdH0gZGF0YSBcbiAqIEByZXR1cm4ge0xvYWRTZWdtZW50fSAgICAgIHJldHVybiBuZXdseSBjb25zdHJ1Y3RlZCBsb2FkIHNlZ21lbnRcbiAqL1xuTG9hZFNlZ21lbnQucHJvdG90eXBlLmltcG9ydEZyb21EYXRhID0gZnVuY3Rpb24oZGF0YSkge1xuXHRyZXR1cm4gbmV3IExvYWRTZWdtZW50KGRhdGEubG9hZFR5cGUsIGRhdGEuaW5pdGlhbFR5cGUsIGRhdGEuZmluYWxUaW1lLCBkYXRhLmluaXRpYWxWYWx1ZSwgZGF0YS5maW5hbFZhbHVlKTtcbn07XG5cblxuXG4vKipcbiAqIEV4cG9ydHMgZGF0YSByZXByZXNlbnRhdGlvbiBvZiB0aGUgc2VnbWVudFxuICogQHJldHVybiB7T2JqZWN0fSAgICAgIGRhdGEgcmVwcmVzZW50YXRpb24gb2YgdGhlIGxvYWQgc2VnbWVudFxuICovXG5Mb2FkU2VnbWVudC5wcm90b3R5cGUuZXhwb3J0RGF0YSA9IGZ1bmN0aW9uKCkge1xuXHR2YXIgZGF0YSA9IHt9O1xuXHRVdGlsLmV4dGVuZChkYXRhLCB0aGlzLnNlZ21lbnREYXRhKTtcblxuXHRkYXRhLnR5cGUgPSAnTG9hZFNlZ21lbnQnO1xuXG5cdHJldHVybiBkYXRhO1xufTtcblxuXG5cbi8qKlxuICogQ2hlY2sgaWYgbG9hZCB0eXBlIGlzIHZhbGlkIGZvciBhIGxpbmVhciBwcm9maWxlXG4gKiBAcGFyYW0gIHtzdHJpbmd9ICB0eXBlIGxvYWQgdHlwZVxuICogQHJldHVybiB7Qm9vbGVhbn0gICAgICB0cnVlIGlmIGxvYWQgdHlwZSB2YWxpZCBcbiAqL1xuTG9hZFNlZ21lbnQucHJvdG90eXBlLmlzVmFsaWRUeXBlID0gZnVuY3Rpb24ocHJvZmlsZVR5cGUsIHR5cGUpIHtcblx0aWYgKHByb2ZpbGVUeXBlID09PSBcImxpbmVhclwiKVxuXHRcdHJldHVybiBMaW5lYXJMb2Fkc0VudW1bdHlwZV07XG5cdGVsc2Vcblx0XHRyZXR1cm4gUm90YXJ5TG9hZHNFbnVtW3R5cGVdO1xufTtcblxuXG52YXIgZmFjdG9yeSA9IHt9O1xuXG5cblxuZmFjdG9yeS5jcmVhdGVMb2FkU2VnbWVudCA9IGZ1bmN0aW9uKHR5cGUsIHQwLCB0ZiwgaW5pdGlhbExvYWQsIGZpbmFsTG9hZCkge1xuXHRpZiAoZmFzdE1hdGgubHQodDAsIDApIHx8IGZhc3RNYXRoLmx0KHRmLCAwKSlcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJpbml0aWFsIHRpbWUgYW5kIGZpbmFsIHRpbWUgbXVzdCBiZSBncmVhdGVyIHRoYW4gMFwiKTtcblx0aWYgKGZhc3RNYXRoLmdlcSh0MCwgdGYpKVxuXHRcdHRocm93IG5ldyBFcnJvcihcImZpbmFsIHRpbWUgbXVzdCBiZSBncmVhdGVyIHRoYW4gaW5pdGFsIHRpbWVcIik7XG5cblx0dmFyIHZhbGlkID0gZmFsc2U7XG5cdGlmIChMaW5lYXJMb2Fkc0VudW1bdHlwZV0pXG5cdFx0dmFsaWQgPSB0cnVlO1xuXHRpZiAoUm90YXJ5TG9hZHNFbnVtW3R5cGVdKVxuXHRcdHZhbGlkID0gdHJ1ZTtcblxuXHRpZiAodmFsaWQgPT09IGZhbHNlKVxuXHRcdHRocm93IG5ldyBFcnJvcihcInVrbm93biBsb2FkIHR5cGUgXCIgKyB0eXBlKTtcblx0dmFyIHNlZ21lbnQgPSBuZXcgTG9hZFNlZ21lbnQodHlwZSwgdDAsIHRmLCBpbml0aWFsTG9hZCwgZmluYWxMb2FkKTtcblx0cmV0dXJuIHNlZ21lbnQ7XG59O1xuXG5mYWN0b3J5LkxpbmVhckxvYWRzRW51bSA9IExpbmVhckxvYWRzRW51bTtcbmZhY3RvcnkuUm90YXJ5TG9hZHNFbnVtID0gUm90YXJ5TG9hZHNFbnVtO1xuZmFjdG9yeS5Mb2FkU2VnbWVudCA9IExvYWRTZWdtZW50O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZhY3Rvcnk7IiwidmFyIGZhc3RNYXRoID0gcmVxdWlyZSgnLi4vdXRpbC9mYXN0TWF0aCcpO1xudmFyIFNlZ21lbnRTdGFzaCA9IHJlcXVpcmUoJy4vc2VnbWVudFN0YXNoJyk7XG52YXIgU2VnbWVudCA9IHJlcXVpcmUoJy4vc2VnbWVudCcpO1xudmFyIFV0aWwgPSByZXF1aXJlKCcuLi91dGlsL3V0aWwnKTtcblxuXG4vKipcbiAqIE1vdGlvblNlZ21lbnQgaXMgYSBjb2xsZWN0aW9uIG9mIG90aGVyIE1vdGlvblNlZ21lbnRzLiBNb3Rpb25TZWdtZW50KHMpIGZvcm0gdGhlIGVudGlyZSBNb3Rpb25Qcm9maWxlXG4gKiBJbml0aWFsaXplIHRoZSBzZWdtZW50IHdpdGggYSB1bmlxdWUgaWQgYW5kIGEgc3Rhc2ggdG8gaG9sZCBvdGhlciBzZWdtZW50c1xuICogQHBhcmFtIHtOdW1iZXJ9IHQwIGluaXRpYWwgVGltZVxuICogQHBhcmFtIHtOdW1iZXJ9IHRmIGZpbmFsIFRpbWVcbiAqL1xudmFyIE1vdGlvblNlZ21lbnQgPSBmdW5jdGlvbih0MCwgdGYpIHtcblxuXG5cdFNlZ21lbnQuU2VnbWVudC5jYWxsKHRoaXMsIHQwLCB0Zik7XG5cblx0Ly9lYWNoIHNlZ21lbnQgY2FuIGhvbGQgb3RoZXIgc2VnbWVudHNcblx0dGhpcy5zZWdtZW50cyA9IFNlZ21lbnRTdGFzaC5tYWtlU3Rhc2goKTtcblxufTtcblxuXG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoU2VnbWVudC5TZWdtZW50LnByb3RvdHlwZSk7XG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IE1vdGlvblNlZ21lbnQ7XG5cblxuTW90aW9uU2VnbWVudC5wcm90b3R5cGUuZXhwb3J0RGF0YSA9IGZ1bmN0aW9uKCkge1xuXHR2YXIgZGF0YU9iaiA9IHt9O1xuXG5cdFV0aWwuZXh0ZW5kKGRhdGFPYmosIHRoaXMuc2VnbWVudERhdGEpO1xuXHRkYXRhT2JqLmNvbnN0cnVjdG9yID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuXG5cdHJldHVybiBkYXRhT2JqO1xuXG59O1xuXG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5pbXBvcnRGcm9tRGF0YSA9IGZ1bmN0aW9uKGRhdGEpIHtcblx0dGhyb3cgbmV3IEVycm9yKFwiaW1wb3J0RnJvbURhdGEoKSBmdW5jdGlvbiBuZWVkcyB0byBiZSBkZWZpbmVkIG9uIGRlcml2ZWQgc2VnbWVudHMhXCIpO1xufTtcblxuXG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5pbml0aWFsaXplV2l0aFNlZ21lbnRzID0gZnVuY3Rpb24oc2VnbWVudHMpIHtcblxuXHRpZiAoIUFycmF5LmlzQXJyYXkoc2VnbWVudHMpKVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGluZyBhcnJheSBvZiBzZWdtZW50cy4gV2FzIG5vdCBhbiBhcnJheVwiKTtcblxuXHQvL2FkZCBlYWNoIHNlZ21lbnRcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGg7IGkrKykge1xuXHRcdHRoaXMuc2VnbWVudHMuaW5zZXJ0QXQoc2VnbWVudHNbaV0sIG51bGwpO1xuXHR9XG59O1xuXG5cbk1vdGlvblNlZ21lbnQucHJvdG90eXBlLmZpbmRTZWdtZW50QXRUaW1lID0gZnVuY3Rpb24odGltZSkge1xuXHR2YXIgc2VnbWVudCA9IHRoaXMuc2VnbWVudHMuZ2V0QWxsU2VnbWVudHMoKS5maWx0ZXIoZnVuY3Rpb24oYlNlZykge1xuXHRcdHJldHVybiBmYXN0TWF0aC5nZXEodGltZSwgYlNlZy5pbml0aWFsVGltZSkgJiYgZmFzdE1hdGgubGVxKHRpbWUsIGJTZWcuZmluYWxUaW1lKTtcblx0fSk7XG5cblx0aWYgKCFVdGlsLmlzT2JqZWN0KHNlZ21lbnRbMF0pKVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkNvdWxkbid0IGZpbmQgYmFzaWMgc2VnbWVudCB0aGF0IGNvbnRhaW5zIHRpbWUgXCIgKyB0aW1lKTtcblxuXHQvLyBjb3VsZCBoYXZlIHR3byBzZWdtZW50cywgaWYgdGltZSBmYWxscyByaWdodCBhdCB0aGUgZW5kIG9mIHRoZSBmaXJzdCBzZWdtZW50XG5cdC8vIGFuZCB0aGUgYmVnaW5uaW5nIG9mIDJuZFxuXHRpZiAoc2VnbWVudC5sZW5ndGggPiAyKVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkZvdW5kIFwiICsgc2VnbWVudC5sZW5ndGggKyBcIiBzZWdtZW50cywgZXhwZWN0aW5nIDEgb3IgMi5cIik7XG5cblx0Ly9zaW5jZSBhbGwgcHJvZmlsZSB2YXJpYWJsZXMgKHAsdixhKSBhcmUgY29udGludW91cywgd2UnbGwganVzdCBwaWNrIHRoZSBmaXJzdCBvbmVcblx0cmV0dXJuIHNlZ21lbnRbMF07XG59O1xuXG5cbk1vdGlvblNlZ21lbnQucHJvdG90eXBlLmV2YWx1YXRlUG9zaXRpb25BdCA9IGZ1bmN0aW9uKHgpIHtcblx0Ly93aGljaCBzZWdtZW50IGRvZXMgeCBmYWxsIGluXG5cblx0dmFyIHNlZ21lbnQgPSB0aGlzLmZpbmRTZWdtZW50QXRUaW1lKHgpO1xuXHRpZihzZWdtZW50LnR5cGUgIT09IFwiYmFzaWNcIilcblx0XHRyZXR1cm4gc2VnbWVudC5ldmFsdWF0ZVBvc2l0aW9uQXQoeCk7XG5cdGVsc2Vcblx0XHRyZXR1cm4gc2VnbWVudC5wb3NpdGlvblBvbHkuZXZhbHVhdGVBdCh4KTtcblxufTtcblxuTW90aW9uU2VnbWVudC5wcm90b3R5cGUuZXZhbHVhdGVWZWxvY2l0eUF0ID0gZnVuY3Rpb24oeCkge1xuXHQvL3doaWNoIHNlZ21lbnQgZG9lcyB4IGZhbGwgaW5cblxuXHR2YXIgc2VnbWVudCA9IHRoaXMuZmluZFNlZ21lbnRBdFRpbWUoeCk7XG5cdGlmKHNlZ21lbnQudHlwZSAhPT0gXCJiYXNpY1wiKSB7XG5cdFx0cmV0dXJuIHNlZ21lbnQuZXZhbHVhdGVWZWxvY2l0eUF0KHgpO1xuXHR9IGVsc2Uge1xuXHRcdHJldHVybiBzZWdtZW50LnZlbG9jaXR5UG9seS5ldmFsdWF0ZUF0KHgpO1xuXHR9XG59O1xuXG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5ldmFsdWF0ZUFjY2VsZXJhdGlvbkF0ID0gZnVuY3Rpb24oeCkge1xuXHQvL3doaWNoIHNlZ21lbnQgZG9lcyB4IGZhbGwgaW5cblxuXHR2YXIgc2VnbWVudCA9IHRoaXMuZmluZFNlZ21lbnRBdFRpbWUoeCk7XG5cdGlmKHNlZ21lbnQudHlwZSAhPT1cImJhc2ljXCIpXG5cdFx0cmV0dXJuIHNlZ21lbnQuZXZhbHVhdGVBY2NlbGVyYXRpb25BdCh4KTtcblx0ZWxzZVxuXHRcdHJldHVybiBzZWdtZW50LmFjY2VsUG9seS5ldmFsdWF0ZUF0KHgpO1xufTtcblxuXG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5ldmFsdWF0ZUplcmtBdCA9IGZ1bmN0aW9uKHgpIHtcblx0Ly93aGljaCBzZWdtZW50IGRvZXMgeCBmYWxsIGluXG5cblx0dmFyIHNlZ21lbnQgPSB0aGlzLmZpbmRTZWdtZW50QXRUaW1lKHgpO1xuXHRpZihzZWdtZW50LnR5cGUgIT09XCJiYXNpY1wiKVxuXHRcdHJldHVybiBzZWdtZW50LmV2YWx1YXRlSmVya0F0KHgpO1xuXHRlbHNlXG5cdFx0cmV0dXJuIHNlZ21lbnQuamVya1BvbHkuZXZhbHVhdGVBdCh4KTtcbn07XG5cblxuTW90aW9uU2VnbWVudC5wcm90b3R5cGUuZ2V0QWxsU2VnbWVudHMgPSBmdW5jdGlvbigpIHtcblx0cmV0dXJuIHRoaXMuc2VnbWVudHMuZ2V0QWxsU2VnbWVudHMoKTtcbn07XG5cblxuXG4vKipcbiAqIENhbGN1bGF0ZXMgZmluYWwgdGltZSwgYWNjZWxlcmF0aW9uLCB2ZWxvY2l0eSBhbmQgcG9zaXRpb24gZm9yIHRoaXMgc2VnbWVudFxuICogQHJldHVybiB7QXJyYXl9IFt0ZixhZix2ZixwZl1cbiAqL1xuTW90aW9uU2VnbWVudC5wcm90b3R5cGUuZ2V0RmluYWxWYWx1ZXMgPSBmdW5jdGlvbigpIHtcblx0dmFyIGxhc3QgPSB0aGlzLnNlZ21lbnRzLmxhc3RTZWdtZW50KCk7XG5cdHZhciB0ZiA9IGxhc3QuZmluYWxUaW1lO1xuXHR2YXIgYWYgPSBsYXN0LmV2YWx1YXRlQWNjZWxlcmF0aW9uQXQodGYpO1xuXHR2YXIgdmYgPSBsYXN0LmV2YWx1YXRlVmVsb2NpdHlBdCh0Zik7XG5cdHZhciBwZiA9IGxhc3QuZXZhbHVhdGVQb3NpdGlvbkF0KHRmKTtcblxuXHRyZXR1cm4gW3RmLCBhZiwgdmYsIHBmXTtcbn07XG5cblxuLyoqXG4gKiBDYWxjdWxhdGVzIGluaXRpYWwgdGltZSwgYWNjZWxlcmF0aW9uLCB2ZWxvY2l0eSBhbmQgcG9zaXRpb24gZm9yIHRoaXMgc2VnbWVudFxuICogQHJldHVybiB7QXJyYXl9IFt0ZixhZix2ZixwZl1cbiAqL1xuTW90aW9uU2VnbWVudC5wcm90b3R5cGUuZ2V0SW5pdGlhbFZhbHVlcyA9IGZ1bmN0aW9uKCkge1xuXHR2YXIgbGFzdCA9IHRoaXMuc2VnbWVudHMuZmlyc3RTZWdtZW50KCk7XG5cdHZhciB0MCA9IGxhc3QuaW5pdGlhbFRpbWU7XG5cdHZhciBhMCA9IGxhc3QuZXZhbHVhdGVBY2NlbGVyYXRpb25BdCh0MCk7XG5cdHZhciB2MCA9IGxhc3QuZXZhbHVhdGVWZWxvY2l0eUF0KHQwKTtcblx0dmFyIHAwID0gbGFzdC5ldmFsdWF0ZVBvc2l0aW9uQXQodDApO1xuXG5cdHJldHVybiBbdDAsIGEwLCB2MCwgcDBdO1xufTtcblxuXG5Nb3Rpb25TZWdtZW50LnByb3RvdHlwZS5zZXRCYXNpY1NlZ21lbnRMb2FkcyA9IGZ1bmN0aW9uKGxvYWRzKSB7XG5cdGlmICghbG9hZHMpXG5cdFx0cmV0dXJuO1xuXHR2YXIgc2VnbWVudHMgPSB0aGlzLmdldEFsbFNlZ21lbnRzKCk7XG5cblx0Zm9yICh2YXIgaSA9IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG5cdFx0c2VnbWVudHNbaV0uZnJpY3Rpb24gPSBsb2Fkcy5mcmljdGlvbiB8fCAwO1xuXHRcdHNlZ21lbnRzW2ldLnRocnVzdCA9IGxvYWRzLnRocnVzdCB8fCAwO1xuXHRcdHNlZ21lbnRzW2ldLmxvYWQgPSBsb2Fkcy5sb2FkIHx8IDA7XG5cdH1cbn07XG5cbnZhciBmYWN0b3J5ID0ge307XG5cbmZhY3RvcnkuTW90aW9uU2VnbWVudCA9IE1vdGlvblNlZ21lbnQ7XG5cbm1vZHVsZS5leHBvcnRzID0gZmFjdG9yeTsiLCIvKipcbiAqIFNlZ21lbnQgcmVwcmVzZW50cyBiYXNpYyBzZWdtZW50IGZ1bmN0aW9uYWxpdHkgLSBoYXMgaW5pdGlhbC9maW5hbCB0aW1lcyBhbmQgaWRcbiAqXG4gKiBCYXNlIHR5cGUgZm9yIE1vdGlvblNlZ21lbnQgYW5kIExvYWRTZWdtZW50XG4gKiBcbiAqIEBwYXJhbSB7TnVtYmVyfSB0MCBpbml0aWFsIFRpbWVcbiAqIEBwYXJhbSB7TnVtYmVyfSB0ZiBmaW5hbCBUaW1lXG4gKi9cbnZhciBTZWdtZW50ID0gZnVuY3Rpb24odDAsIHRmKSB7XG5cblxuXHR0aGlzLmluaXRpYWxUaW1lID0gdDA7XG5cdHRoaXMuZmluYWxUaW1lID0gdGY7XG5cblx0dGhpcy5pZCA9IHRoaXMuZ2VuZXJhdGVJZCgpO1xuXG59O1xuXG5cblxuLyoqXG4gKiBHZW5lcmF0ZSB1bmlxdWUgaWQgXG4gKi9cblNlZ21lbnQucHJvdG90eXBlLmdlbmVyYXRlSWQgPSBmdW5jdGlvbigpIHtcblxuXHR2YXIgbVNlYyA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkudG9TdHJpbmcoKTtcblx0dmFyIHJuZCA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwKS50b1N0cmluZygpO1xuXG5cdHZhciBpZFN0ciA9IG1TZWMgKyBybmQ7XG5cblx0cmV0dXJuIHBhcnNlSW50KGlkU3RyLCAxMCk7XG5cbn07XG5cblxudmFyIGZhY3RvcnkgPSB7fTtcblxuZmFjdG9yeS5TZWdtZW50ID0gU2VnbWVudDtcblxubW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5OyIsIi8qKlxuICogU2VnbWVudFN0YXNoIGlzIHRoZSBiYWNraW5nIGRhdGEgc3RydWN0dXJlIGZvciBsb3cgbGV2ZWwgc2VnbWVudCBvcGVyYXRpb25zLlxuICogQSBtb3Rpb24gcHJvZmlsZSBpcyByZWFsbHkgYSBzb3J0ZWQgYXJyYXkgb2YgU2VnbWVudHMuIFNvbWUgU2VnbWVudHMgbWF5IGNvbnRhaW4gb3RoZXIgU2VnbWVudHNcbiAqXG4gKiBBbHNvLCBpbiBvcmRlciB0byBzcGVlZCB1cCBzZWFyY2ggYW5kIGluc2VydC9kZWxldGUgb3BlcmF0aW9uLCB0d28gZGF0YSBzdHJ1Y3R1cmVzIGFyZSB1c2VkOlxuICogbGlua2VkIGxpc3QgLSBpbnNlcnRcbiAqIGhhc2htYXAoYXJyYXkpIC0gc2VhcmNoaW5nXG4gKlxuICovXG5cbnZhciBGYXN0TWF0aD1yZXF1aXJlKCcuLi91dGlsL2Zhc3RNYXRoJyk7XG52YXIgTGlua2VkTGlzdD1yZXF1aXJlKCcuLi91dGlsL2xpbmtlZExpc3QnKTtcblxuXG52YXIgU2VnbWVudFN0YXNoID0gZnVuY3Rpb24oKSB7XG5cblx0LyoqXG5cdCAqIFtub2Rlc0hhc2ggZGVzY3JpcHRpb25dXG5cdCAqIEB0eXBlIHtPYmplY3R9IGFzc29jaWF0aXZlIGFycmF5IG9mIG5vZGVzLiBFYWNoIG5vZGUgY29udGFpbnMgYSBtb3Rpb24gb3IgbG9hZCBzZWdtZW50XG5cdCAqL1xuXHR0aGlzLm5vZGVzSGFzaCA9IHt9O1xuXG5cdHRoaXMuc2VnbWVudHNMaXN0ID0gTGlua2VkTGlzdC5tYWtlTGlua2VkTGlzdCgpO1xufTtcblxuLyoqXG4gKiBJbnNlcnRzIGEgc2VnbWVudCBpbiBmcm9udCBvZiBhbm90aGVyIHNlZ21lbnQgaWRlbnRpZmllZCBieSBzZWdtZW50SWRcbiAqIEBwYXJhbSB7U2VnbWVudH0gc2VnbWVudCAgIFNlZ21lbnQgdG8gaW5zZXJ0XG4gKiBAcGFyYW0ge2ludGVnZXJ9IHNlZ21lbnRJZCBzZWdtZW50IElkIG9mIHNlZ21lbnQgdG8gaW5zZXJ0IGluIGZyb250IG9mLiBJZiBudWxsLCBhZGQgYXQgdGhlIGVuZFxuICovXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmluc2VydEF0ID0gZnVuY3Rpb24oc2VnbWVudCwgc2VnbWVudElkKSB7XG5cdGlmICghc2VnbWVudClcblx0XHR0aHJvdyBuZXcgRXJyb3IoXCJJbnNlcnQgZXhwZWN0cyBzZWdtZW50IHRvIGJlIG5vdCBudWxsIVwiKTtcblxuXHR2YXIgbmV3Tm9kZTtcblxuXHRpZiAoc2VnbWVudElkKSB7IC8vdGhlcmUgbmVlZHMgdG8gYmUgYW4gZXhpc3Rpbmcgbm9kZSB3aXRoIHRoaXMgaWRcblx0XHR2YXIgZXhpc3RpbmdOb2RlID0gdGhpcy5ub2Rlc0hhc2hbc2VnbWVudElkXTtcblx0XHRpZiAoIWV4aXN0aW5nTm9kZSlcblx0XHRcdHJldHVybiBudWxsO1xuXG5cdFx0bmV3Tm9kZSA9IHRoaXMuc2VnbWVudHNMaXN0Lmluc2VydEF0KGV4aXN0aW5nTm9kZSwgc2VnbWVudCk7XG5cblx0fSBlbHNlIHtcblx0XHRuZXdOb2RlID0gdGhpcy5zZWdtZW50c0xpc3QuYWRkKHNlZ21lbnQpO1xuXHR9XG5cblx0dGhpcy5ub2Rlc0hhc2hbc2VnbWVudC5pZF0gPSBuZXdOb2RlO1xuXHRyZXR1cm4gc2VnbWVudDtcbn07XG5cblxuU2VnbWVudFN0YXNoLnByb3RvdHlwZS5maW5kQnlJZCA9IGZ1bmN0aW9uKHNlZ21lbnRJZCkge1xuXHR2YXIgbm9kZSA9IHRoaXMubm9kZXNIYXNoW3NlZ21lbnRJZF07XG5cdGlmIChub2RlKVxuXHRcdHJldHVybiB0aGlzLm5vZGVzSGFzaFtzZWdtZW50SWRdLmRhdGE7XG59O1xuXG5cblNlZ21lbnRTdGFzaC5wcm90b3R5cGUuZ2V0TmV4dFNlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50SWQpIHtcblx0dmFyIG5vZGUgPSB0aGlzLm5vZGVzSGFzaFtzZWdtZW50SWRdO1xuXHRpZiAobm9kZSAmJiBub2RlLm5leHQpXG5cdFx0cmV0dXJuIG5vZGUubmV4dC5kYXRhO1xuXHRyZXR1cm4gbnVsbDtcbn07XG5cblxuU2VnbWVudFN0YXNoLnByb3RvdHlwZS5nZXRQcmV2aW91c1NlZ21lbnQgPSBmdW5jdGlvbihzZWdtZW50SWQpIHtcblx0dmFyIG5vZGUgPSB0aGlzLm5vZGVzSGFzaFtzZWdtZW50SWRdO1xuXHRpZiAobm9kZSAmJiBub2RlLnByZXZpb3VzKVxuXHRcdHJldHVybiBub2RlLnByZXZpb3VzLmRhdGE7XG5cdHJldHVybiBudWxsO1xufTtcblxuXG4vKipcbiAqIEdldHMgYWxsIHNlZ21lbnRzIGN1cnJlbnRseSBpbiB0aGUgc3Rhc2hcbiAqIEByZXR1cm5zIHtBcnJheX0gYXJyYXkgb2YgU2VnbWVudFxuICovXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmdldEFsbFNlZ21lbnRzID0gZnVuY3Rpb24oKSB7XG5cblx0cmV0dXJuIHRoaXMuc2VnbWVudHNMaXN0LmdldERhdGFBcnJheSgpO1xufTtcblxuXG4vKipcbiAqIENsZWFycyBhbGwgc2VnbWVudHMgaW4gdGhlIHN0YXNoXG4gKi9cblNlZ21lbnRTdGFzaC5wcm90b3R5cGUuY2xlYXJBbGxTZWdtZW50cyA9IGZ1bmN0aW9uKCkge1xuXHR0aGlzLm5vZGVzSGFzaCA9IHt9O1xuXHR0aGlzLnNlZ21lbnRzTGlzdC5jbGVhckFsbCgpO1xufTtcblxuXG4vKipcbiAqIERlbGV0ZXMgc2VnbWVudCBzcGVjaWZpZWQgYnkgc2VnbWVudCBpZFxuICogQHBhcmFtIHtOdW1iZXJ9IHNlZ21lbnRJZFxuICovXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKHNlZ21lbnRJZCkge1xuXHRpZiAoIUZhc3RNYXRoLmlzTnVtZXJpYyhzZWdtZW50SWQpIHx8IEZhc3RNYXRoLmx0KDApKVxuXHRcdHRocm93IG5ldyBFcnJvcihcIkRlbGV0ZSBleHBlY3RzIGlkIHRvIGJlIGEgbnVtYmVyID49MFwiKTtcblxuXHR2YXIgbm9kZVRvRGVsID0gdGhpcy5ub2Rlc0hhc2hbc2VnbWVudElkXTtcblx0aWYgKCFub2RlVG9EZWwpXG5cdFx0cmV0dXJuIG51bGw7XG5cblx0dmFyIGRlbGV0ZWROb2RlID0gbm9kZVRvRGVsO1xuXHRkZWxldGUgdGhpcy5ub2Rlc0hhc2hbc2VnbWVudElkXTtcblxuXHR0aGlzLnNlZ21lbnRzTGlzdC5yZW1vdmVOb2RlKG5vZGVUb0RlbCk7XG5cblx0cmV0dXJuIG5vZGVUb0RlbC5kYXRhO1xufTtcblxuXG4vKipcbiAqIEdldHMgdGhlIGxhc3Qgc2VnbWVudFxuICogQHJldHVybiB7U2VnbWVudH0gbGFzdCBzZWdtZW50IGluIHRoZSBsaXN0XG4gKi9cblNlZ21lbnRTdGFzaC5wcm90b3R5cGUubGFzdFNlZ21lbnQgPSBmdW5jdGlvbigpIHtcblx0aWYgKHRoaXMuc2VnbWVudHNMaXN0LnRhaWwpXG5cdFx0cmV0dXJuIHRoaXMuc2VnbWVudHNMaXN0LnRhaWwuZGF0YTtcblx0cmV0dXJuIG51bGw7XG59O1xuXG5cblNlZ21lbnRTdGFzaC5wcm90b3R5cGUuZmlyc3RTZWdtZW50ID0gZnVuY3Rpb24oKSB7XG5cdGlmICh0aGlzLnNlZ21lbnRzTGlzdC5oZWFkKVxuXHRcdHJldHVybiB0aGlzLnNlZ21lbnRzTGlzdC5oZWFkLmRhdGE7XG5cdHJldHVybiBudWxsO1xufTtcblxuXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmNvdW50U2VnbWVudHMgPSBmdW5jdGlvbigpIHtcblx0cmV0dXJuIHRoaXMuc2VnbWVudHNMaXN0Lmxlbmd0aCgpO1xufTtcblxuXG4vKipcbiAqIEZpbmQgc2VnbWVudCB3aXRoaW4gdGhlIHN0YXNoIHRoYXQgc3RhcnRzIHdpdGggdGhlIHNwZWNpZmllZCB0aW1lXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGluaXRpYWxUaW1lIGluaXRpYWwgdGltZVxuICogQHJldHVybiB7U2VnbWVudH0gICAgICAgICAgICAgc2VnbWVudCB0aGF0IHN0YXJ0cyB3aXRoIHRoZSBzcGVjaWZpZWQgaW5pdGlhbCB0aW1lXG4gKi9cblNlZ21lbnRTdGFzaC5wcm90b3R5cGUuZmluZFNlZ21lbnRXaXRoSW5pdGlhbFRpbWUgPSBmdW5jdGlvbihpbml0aWFsVGltZSkge1xuXG5cblx0dmFyIGN1cnJlbnROb2RlID0gdGhpcy5zZWdtZW50c0xpc3QuaGVhZDtcblxuXG5cdC8vIDJuZCB1c2UtY2FzZTogYSB2YWxpZCBwb3NpdGlvblxuXHR3aGlsZSAoY3VycmVudE5vZGUpIHtcblxuXG5cdFx0aWYgKEZhc3RNYXRoLmVxdWFsKGluaXRpYWxUaW1lLCBjdXJyZW50Tm9kZS5kYXRhLmluaXRpYWxUaW1lKSlcblx0XHRcdHJldHVybiBjdXJyZW50Tm9kZS5kYXRhO1xuXG5cdFx0Y3VycmVudE5vZGUgPSBjdXJyZW50Tm9kZS5uZXh0O1xuXHR9XG5cblxuXHRyZXR1cm4gbnVsbDtcbn07XG5cblxuLyoqXG4gKiBGaW5kcyBzZWdtZW50IHRoYXQgaGFzIGluaXRpYWxUaW1lIG9yIGZpbmFsVGltZSBpbnNpZGUgb2YgaXRcbiAqIEBwYXJhbSAge051bWJlcn0gaW5pdGlhbFRpbWUgICAgIFtkZXNjcmlwdGlvbl1cbiAqIEBwYXJhbSAge051bWJlcn0gZmluYWxUaW1lICAgICAgIFtkZXNjcmlwdGlvbl1cbiAqIEByZXR1cm4ge1NlZ21lbnR9ICAgICAgICAgICAgXHQgZm91bmQgc2VnbWVudFxuICovXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmZpbmRPdmVybGFwcGluZ1NlZ21lbnQgPSBmdW5jdGlvbihpbml0aWFsVGltZSxmaW5hbFRpbWUpIHtcblxuXHR2YXIgY3VycmVudE5vZGUgPSB0aGlzLnNlZ21lbnRzTGlzdC5oZWFkO1xuXG5cblx0Ly8gMm5kIHVzZS1jYXNlOiBhIHZhbGlkIHBvc2l0aW9uXG5cdHdoaWxlIChjdXJyZW50Tm9kZSkge1xuXG5cdFx0Ly9jYXNlIDEgLSBuZXcgc2VnbWVudCBmaW5hbCB0aW1lIGZhbGxzIGludG8gYW4gZXhpc3Rpbmcgc2VnbWVudFxuXHRcdGlmIChGYXN0TWF0aC5ndChmaW5hbFRpbWUsIGN1cnJlbnROb2RlLmRhdGEuaW5pdGlhbFRpbWUpICYmXG5cdFx0XHRGYXN0TWF0aC5sZXEoZmluYWxUaW1lLGN1cnJlbnROb2RlLmRhdGEuZmluYWxUaW1lKSlcblx0XHRcdHJldHVybiBjdXJyZW50Tm9kZS5kYXRhO1xuXG5cdFx0Ly9jYXNlIDIgLSBuZXcgc2VnbWVudCBpbml0aWFsIHRpbWUgZmFsbHMgaW50byBhbiBleGlzdGluZyBzZWdtZW50XG5cdFx0aWYgKEZhc3RNYXRoLmdlcShpbml0aWFsVGltZSwgY3VycmVudE5vZGUuZGF0YS5pbml0aWFsVGltZSkgJiZcblx0XHRcdEZhc3RNYXRoLmx0KGluaXRpYWxUaW1lLGN1cnJlbnROb2RlLmRhdGEuZmluYWxUaW1lKSlcblx0XHRcdHJldHVybiBjdXJyZW50Tm9kZS5kYXRhO1xuXG5cdFx0Ly9jYXNlIDMgLSBuZXcgc2VnbWVudCBmdWxseSBlbnZlbG9wZXMgYW4gZXhpc3Rpbmcgc2VnbWVudFxuXHRcdGlmKEZhc3RNYXRoLmdlcShpbml0aWFsVGltZSxjdXJyZW50Tm9kZS5kYXRhLmluaXRpYWxUaW1lKSAmJlxuXHRcdFx0RmFzdE1hdGgubGVxKGZpbmFsVGltZSxjdXJyZW50Tm9kZS5kYXRhLmZpbmFsVGltZSkpXG5cdFx0XHRyZXR1cm4gY3VycmVudE5vZGUuZGF0YTtcblxuXHRcdC8vY2FzZSA0IC0gbmV3IHNlZ21lbnQgZmFsbHMgd2l0aGluIGFuIGV4aXN0aW5nIHNlZ21lbnRcblx0XHRpZihGYXN0TWF0aC5sZXEoaW5pdGlhbFRpbWUsY3VycmVudE5vZGUuZGF0YS5pbml0aWFsVGltZSkgJiZcblx0XHRcdEZhc3RNYXRoLmdlcShmaW5hbFRpbWUsY3VycmVudE5vZGUuZGF0YS5maW5hbFRpbWUpKVxuXHRcdFx0cmV0dXJuIGN1cnJlbnROb2RlLmRhdGE7XG5cblx0XHRjdXJyZW50Tm9kZSA9IGN1cnJlbnROb2RlLm5leHQ7XG5cdH1cblxuXG5cdHJldHVybiBudWxsO1xufTtcblxuXG4vKipcbiAqIEZpbmRzIHByZXZpb3VzIHNlZ21lbnQgdXNpbmcgaW5pdGlhbCB0aW1lXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHQwIGluaXRpYWwgdGltZVxuICogQHJldHVybiB7U2VnbWVudH0gICAgcHJldmlvdXMgc2VnbWVudFxuICovXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmdldFByZXZpb3VzQnlJbml0aWFsVGltZSA9IGZ1bmN0aW9uKHQwKXtcblx0dmFyIGN1cnJlbnROb2RlID0gdGhpcy5zZWdtZW50c0xpc3QuaGVhZDtcblxuXG5cdC8vIDJuZCB1c2UtY2FzZTogYSB2YWxpZCBwb3NpdGlvblxuXHR3aGlsZSAoY3VycmVudE5vZGUpIHtcblxuXG5cdFx0aWYgKEZhc3RNYXRoLmxlcSh0MCwgY3VycmVudE5vZGUuZGF0YS5maW5hbFRpbWUpKVxuXHRcdFx0cmV0dXJuIGN1cnJlbnROb2RlLmRhdGE7XG5cblx0XHRjdXJyZW50Tm9kZSA9IGN1cnJlbnROb2RlLm5leHQ7XG5cdH1cblxuXG5cdHJldHVybiBudWxsO1xufTtcblxuXG5TZWdtZW50U3Rhc2gucHJvdG90eXBlLmluaXRpYWxpemVXaXRoU2VnbWVudHMgPSBmdW5jdGlvbihzZWdtZW50cykge1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoc2VnbWVudHMpKVxuXHRcdHRocm93IG5ldyBFcnJvcihcImV4cGVjdGluZyBhbiBhcnJheSBvZiBTZWdtZW50c1wiKTtcblxuXHR0aGlzLmNsZWFyQWxsU2VnbWVudHMoKTtcblxuXHRmb3IgKHZhciBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG5cdFx0dGhpcy5pbnNlcnRBdChzZWdtZW50c1tpXSwgbnVsbCk7XG5cdH1cbn07XG5cblxudmFyIGZhY3RvcnkgPSB7fTtcblxuZmFjdG9yeS5tYWtlU3Rhc2ggPSBmdW5jdGlvbigpIHtcblx0cmV0dXJuIG5ldyBTZWdtZW50U3Rhc2goKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzPWZhY3Rvcnk7IiwidmFyIEZhc3RNYXRoID0gZnVuY3Rpb24oKSB7XG5cdFxufTtcblxuXG5cbnZhciBlcHNpbG9uID0gMi4yMjA0NDYwNDkyNTAzMTNlLTE2O1xuXG5GYXN0TWF0aC5wcm90b3R5cGUuZXBzaWxvbiA9IGVwc2lsb247XG5cblxuRmFzdE1hdGgucHJvdG90eXBlLmVxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuXHRyZXR1cm4gdGhpcy5hYnMoYSAtIGIpIDwgKGVwc2lsb24pO1xuXG59O1xuXG5GYXN0TWF0aC5wcm90b3R5cGUubm90RXF1YWwgPSBmdW5jdGlvbihhLCBiKSB7XG5cdHJldHVybiAhdGhpcy5lcXVhbChhLCBiKTtcbn07XG5cbkZhc3RNYXRoLnByb3RvdHlwZS5sZXEgPSBmdW5jdGlvbihhLCBiKSB7XG5cdHJldHVybiBhIDwgYiB8fCB0aGlzLmVxdWFsKGEsIGIpO1xufTtcblxuRmFzdE1hdGgucHJvdG90eXBlLmdlcSA9IGZ1bmN0aW9uKGEsIGIpIHtcblx0cmV0dXJuIGEgPiBiIHx8IHRoaXMuZXF1YWwoYSwgYik7XG59O1xuXG5GYXN0TWF0aC5wcm90b3R5cGUubHQgPSBmdW5jdGlvbihhLCBiKSB7XG5cdHJldHVybiBhIDwgYiAmJiAhdGhpcy5lcXVhbChhLCBiKTtcbn07XG5cbkZhc3RNYXRoLnByb3RvdHlwZS5ndCA9IGZ1bmN0aW9uKGEsIGIpIHtcblx0cmV0dXJuIGEgPiBiICYmICF0aGlzLmVxdWFsKGEsIGIpO1xufTtcblxuRmFzdE1hdGgucHJvdG90eXBlLm1heCA9IGZ1bmN0aW9uKGEsIGIpIHtcblx0aWYgKGEgPiBiKSB7XG5cdFx0cmV0dXJuIGE7XG5cdH1cblxuXHRyZXR1cm4gYjtcbn07XG5cbkZhc3RNYXRoLnByb3RvdHlwZS5taW4gPSBmdW5jdGlvbihhLCBiKSB7XG5cdGlmIChhIDwgYikge1xuXHRcdHJldHVybiBhO1xuXHR9XG5cblx0cmV0dXJuIGI7XG59O1xuXG5GYXN0TWF0aC5wcm90b3R5cGUuYWJzID0gZnVuY3Rpb24oYSkge1xuXHRpZiAoYSA8IDApIHtcblx0XHRyZXR1cm4gLWE7XG5cdH1cblxuXHRyZXR1cm4gYTtcbn07XG5cbkZhc3RNYXRoLnByb3RvdHlwZS5zaWduID0gZnVuY3Rpb24oYSkge1xuXHRpZiAoYSA8IDApIHtcblx0XHRyZXR1cm4gLTE7XG5cdH1cblxuXHRpZiAoYSA+IDApIHtcblx0XHRyZXR1cm4gMTtcblx0fVxuXG5cdHJldHVybiAwO1xufTtcblxuRmFzdE1hdGgucHJvdG90eXBlLnNxciA9IGZ1bmN0aW9uKHgpIHtcblx0cmV0dXJuIHggKiB4O1xufTtcblxuRmFzdE1hdGgucHJvdG90eXBlLnRydW5jID0gZnVuY3Rpb24oYSkge1xuXHR2YXIgbnVtID0gcGFyc2VJbnQoYSwgMTApO1xuXHRpZiAoaXNOYU4obnVtKSkge1xuXHRcdHJldHVybiBOYU47XG5cdH1cblxuXHRyZXR1cm4gcGFyc2VJbnQobnVtLnRvRml4ZWQoMCksIDEwKTtcbn07XG5cbkZhc3RNYXRoLnByb3RvdHlwZS5maXggPSBmdW5jdGlvbihhLCBwKSB7XG5cdHZhciBudW0gPSBwYXJzZUZsb2F0KGEpO1xuXHRpZiAoaXNOYU4obnVtKSkge1xuXHRcdHJldHVybiBOYU47XG5cdH1cblxuXHRwID0gcGFyc2VJbnQocCwgMTApO1xuXHRpZiAoaXNOYU4ocCkpIHtcblx0XHRwID0gMDtcblx0fVxuXG5cdHJldHVybiBwYXJzZUZsb2F0KG51bS50b0ZpeGVkKHApKTtcbn07XG4vKipcbiAqIFJldHVybnMgdHJ1ZSBpZiBwYXJhbWV0ZXIgaXMgbnVtZXJpY1xuICogQHBhcmFtICB7b2JqZWN0fSAgbiBvYmplY3QgdG8gdGVzdFxuICogQHJldHVybiB7Qm9vbGVhbn0gICB0cnVlIGlmIG9iamVjdCBpcyBudW1lcmljXG4gKi9cbkZhc3RNYXRoLnByb3RvdHlwZS5pc051bWVyaWMgPSBmdW5jdGlvbihuKSB7XG5cdGlmIChhcmd1bWVudHMubGVuZ3RoICE9IDEpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdpc051bWVyaWMgZXhwZWN0cyBvbmUgcGFyYW1ldGVyJyk7XG5cdHJldHVybiAhaXNOYU4ocGFyc2VGbG9hdChuKSkgJiYgaXNGaW5pdGUobik7XG59O1xuXG4vKipcbiAqIERldGVybWluZXMgaWYgYWxsIG1lbWJlcnMgb2YgYXJyYXkgYXJlIG51bWVyaWNcbiAqIEByZXR1cm4ge0Jvb2xlYW59ICAgICAgdHJ1ZSBpZiBhbGwgYXJyYXkgbWVtYmVycyBhcmUgbnVtZXJpY1xuICovXG5GYXN0TWF0aC5wcm90b3R5cGUuYXJlTnVtZXJpYyA9IGZ1bmN0aW9uKCkge1xuXG5cdHZhciBhcmdMZW5ndGggPSBhcmd1bWVudHMubGVuZ3RoO1xuXHRpZiAoYXJnTGVuZ3RoID09PSAwKVxuXHRcdHJldHVybiBmYWxzZTtcblxuXHRmb3IgKHZhciBpID0gMDsgaSA8IGFyZ0xlbmd0aDsgaSsrKSB7XG5cdFx0aWYgKCF0aGlzLmlzTnVtZXJpYyhhcmd1bWVudHNbaV0pKVxuXHRcdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cdHJldHVybiB0cnVlO1xufTtcblxuLyoqXG4gKiBIZWxwZXIgZnVuY3Rpb24gdG8gYmUgdXNlZCB3aGVuIGNvbXBhcmluZyBudW1iZXJzXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGEgZmlyc3QgbnVtYmVyXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGIgc2Vjb25kIG51bWJlclxuICogQHJldHVybiB7TnVtYmVyfSAgIHBvc2l0aXZlIGlmIGE+YiwgbmVnYXRpdmUgaWYgYTxiLCB6ZXJvIGlmIGE9PWJcbiAqL1xuRmFzdE1hdGgucHJvdG90eXBlLmNvbXBhcmVOdW1iZXJzID0gZnVuY3Rpb24oYSwgYikge1xuXG5cdC8vbm90IHVzaW5nIHN0cmFpZ2h0IGEtYiBjb21wYXJpc29uIGhlcmUgaW4gb3JkZXIgdG8gYXZvaWRcblx0Ly9yb3VuZGluZyBlcnJvcnMhXG5cdGlmICh0aGlzLmd0KGEsIGIpKVxuXHRcdHJldHVybiAxO1xuXHRpZiAodGhpcy5sdChhLCBiKSlcblx0XHRyZXR1cm4gLTE7XG5cblx0cmV0dXJuIDA7XG59O1xuXG4vKipcbiAqIFBlcmZvcm1zIGEgYmluYXJ5IHNlYXJjaCBvbiB0aGUgaG9zdCBhcnJheS4gVGhpcyBtZXRob2QgY2FuIGVpdGhlciBiZVxuICogaW5qZWN0ZWQgaW50byBBcnJheS5wcm90b3R5cGUgb3IgY2FsbGVkIHdpdGggYSBzcGVjaWZpZWQgc2NvcGUgbGlrZSB0aGlzOlxuICogYmluYXJ5SW5kZXhPZi5jYWxsKHNvbWVBcnJheSwgc2VhcmNoRWxlbWVudCk7XG4gKlxuICogQ291cnRlc3kgb2YgaHR0cDovL29saS5tZS51ay8yMDEzLzA2LzA4L3NlYXJjaGluZy1qYXZhc2NyaXB0LWFycmF5cy13aXRoLWEtYmluYXJ5LXNlYXJjaC9cbiAqXG4gKiB1c2FnZTogdmFyIGluZGV4ID0gYmluYXJ5SW5kZXhPZi5jYWxsKG1vZGVscywgc29tZU1vZGVsKTtcbiAqIFxuICogQHBhcmFtIHsqfSBzZWFyY2hFbGVtZW50IFRoZSBpdGVtIHRvIHNlYXJjaCBmb3Igd2l0aGluIHRoZSBhcnJheS5cbiAqIEByZXR1cm4ge051bWJlcn0gVGhlIGluZGV4IG9mIHRoZSBlbGVtZW50IHdoaWNoIGRlZmF1bHRzIHRvIC0xIHdoZW4gbm90IGZvdW5kLlxuICovXG5GYXN0TWF0aC5wcm90b3R5cGUuYmluYXJ5SW5kZXhPZiA9IGZ1bmN0aW9uKHNlYXJjaEVsZW1lbnQpIHtcblxuXHR2YXIgbWluSW5kZXggPSAwO1xuXHR2YXIgbWF4SW5kZXggPSB0aGlzLmxlbmd0aCAtIDE7XG5cdHZhciBjdXJyZW50SW5kZXg7XG5cdHZhciBjdXJyZW50RWxlbWVudDtcblx0dmFyIHJlc3VsdEluZGV4O1xuXG5cdHdoaWxlIChtaW5JbmRleCA8PSBtYXhJbmRleCkge1xuXHRcdHJlc3VsdEluZGV4ID0gY3VycmVudEluZGV4ID0gKG1pbkluZGV4ICsgbWF4SW5kZXgpIC8gMiB8IDA7XG5cdFx0Y3VycmVudEVsZW1lbnQgPSB0aGlzW2N1cnJlbnRJbmRleF07XG5cblx0XHRpZiAoY3VycmVudEVsZW1lbnQgPCBzZWFyY2hFbGVtZW50KSB7XG5cdFx0XHRtaW5JbmRleCA9IGN1cnJlbnRJbmRleCArIDE7XG5cdFx0fSBlbHNlIGlmIChjdXJyZW50RWxlbWVudCA+IHNlYXJjaEVsZW1lbnQpIHtcblx0XHRcdG1heEluZGV4ID0gY3VycmVudEluZGV4IC0gMTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuIGN1cnJlbnRJbmRleDtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gfm1heEluZGV4O1xufTtcbkZhc3RNYXRoLnByb3RvdHlwZS5iaW5hcnlJbmRleE9mT2JqZWN0ID0gZnVuY3Rpb24oc2VhcmNoRWxlbWVudCwgYWNjZXNzb3IpIHtcblxuXHR2YXIgbWluSW5kZXggPSAwO1xuXHR2YXIgbWF4SW5kZXggPSB0aGlzLmxlbmd0aCAtIDE7XG5cdHZhciBjdXJyZW50SW5kZXg7XG5cdHZhciBjdXJyZW50RWxlbWVudDtcblx0dmFyIHJlc3VsdEluZGV4O1xuXG5cdHdoaWxlIChtaW5JbmRleCA8PSBtYXhJbmRleCkge1xuXHRcdHJlc3VsdEluZGV4ID0gY3VycmVudEluZGV4ID0gKG1pbkluZGV4ICsgbWF4SW5kZXgpIC8gMiB8IDA7XG5cdFx0Y3VycmVudEVsZW1lbnQgPSB0aGlzW2N1cnJlbnRJbmRleF07XG5cblx0XHR2YXIgY3VycmVudCA9IGFjY2Vzc29yLmNhbGwoY3VycmVudEVsZW1lbnQpO1xuXHRcdHZhciBzZWFyY2ggPSBzZWFyY2hFbGVtZW50O1xuXG5cdFx0aWYgKGN1cnJlbnQgPCBzZWFyY2gpIHtcblx0XHRcdG1pbkluZGV4ID0gY3VycmVudEluZGV4ICsgMTtcblx0XHR9IGVsc2UgaWYgKGN1cnJlbnQgPiBzZWFyY2gpIHtcblx0XHRcdG1heEluZGV4ID0gY3VycmVudEluZGV4IC0gMTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuIGN1cnJlbnRJbmRleDtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gfm1heEluZGV4O1xufTtcblxuXG5cbm1vZHVsZS5leHBvcnRzID0gbmV3IEZhc3RNYXRoKCk7IiwiLyoqXG4gKiBOb2RlIG9mIHRoZSBsaW5rZWQgbGlzdFxuICogQHBhcmFtIHtPamJlY3R9IGRhdGEgZGF0YSBvYmplY3RcbiAqL1xudmFyIE5vZGUgPSBmdW5jdGlvbihkYXRhKSB7XG5cdHRoaXMuZGF0YSA9IGRhdGE7XG5cdHRoaXMubmV4dCA9IG51bGw7XG5cdHRoaXMucHJldmlvdXMgPSBudWxsO1xufTtcblxuXG4vKipcbiAqIERvdWJsZSBsaW5rZWQgbGlzdCBmdW5jdGlvbmFsaXR5XG4gKiBzb21lIGNvZGUgc3dpcGVkIGZyb206IGh0dHBzOi8vY29kZS50dXRzcGx1cy5jb20vYXJ0aWNsZXMvZGF0YS1zdHJ1Y3R1cmVzLXdpdGgtamF2YXNjcmlwdC1zaW5nbHktbGlua2VkLWxpc3QtYW5kLWRvdWJseS1saW5rZWQtbGlzdC0tY21zLTIzMzkyXG4gKi9cbnZhciBMaW5rZWRMaXN0ID0gZnVuY3Rpb24oKSB7XG5cdHRoaXMuX2xlbmd0aCA9IDA7XG5cdHRoaXMuaGVhZCA9IG51bGw7XG5cdHRoaXMudGFpbCA9IG51bGw7XG59O1xuLyoqXG4gKiBBZGQgYSB2YWx1ZSBhdCB0aGUgZW5kIG9mIHRoZSBsaXN0XG4gKiBAcGFyYW0ge09iamVjdH0gdmFsdWUgdmFsdWUgdG8gYWRkXG4gKi9cbkxpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG5cdHZhciBub2RlID0gbmV3IE5vZGUodmFsdWUpO1xuXG5cdGlmICh0aGlzLl9sZW5ndGgpIHtcblx0XHR0aGlzLnRhaWwubmV4dCA9IG5vZGU7XG5cdFx0bm9kZS5wcmV2aW91cyA9IHRoaXMudGFpbDtcblx0XHR0aGlzLnRhaWwgPSBub2RlO1xuXHR9IGVsc2Uge1xuXHRcdHRoaXMuaGVhZCA9IG5vZGU7XG5cdFx0dGhpcy50YWlsID0gbm9kZTtcblx0fVxuXG5cdHRoaXMuX2xlbmd0aCsrO1xuXG5cdHJldHVybiBub2RlO1xufTtcblxuXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5jbGVhckFsbCA9IGZ1bmN0aW9uKCkge1xuXHR0aGlzLl9sZW5ndGggPSAwO1xuXHR0aGlzLmhlYWQgPSBudWxsO1xuXHR0aGlzLnRhaWwgPSBudWxsO1xufTtcblxuXG4vKipcbiAqIEluc2VydHMgaW50byB0aGUgbGlzdCB1c2luZyBhbiBleGlzdGluZyBub2RlXG4gKiBAcGFyYW0gIHtOb2RlfSBleGlzdGluZyBleGlzdGluZyBOb2RlXG4gKiBAcGFyYW0gIHtPYmplY3R9IGRhdGEgICAgIG5ldyBkYXRhIHRvIGluc2VydCBiZWZvcmUgZXhpc3Rpbmcgbm9kZVxuICogQHJldHVybiB7Tm9kZX0gICAgICAgICAgbmV3IG5vZGUgdGhhdCB3YXMgaW5zZXJ0ZWRcbiAqL1xuTGlua2VkTGlzdC5wcm90b3R5cGUuaW5zZXJ0QXQgPSBmdW5jdGlvbihleGlzdGluZywgZGF0YSkge1xuXHR2YXIgbm9kZSA9IG5ldyBOb2RlKGRhdGEpO1xuXHR2YXIgbmV4dCA9IGV4aXN0aW5nLm5leHQ7XG5cdHZhciBwcmV2ID0gZXhpc3RpbmcucHJldmlvdXM7XG5cblx0bm9kZS5uZXh0ID0gZXhpc3Rpbmc7XG5cdGV4aXN0aW5nLnByZXZpb3VzID0gbm9kZTtcblxuXHQvLyBpZiB0aGVyZSBpcyBhIHByZXZpb3VzIG5vZGUsIHdpcmUgaXQgdXBcblx0aWYgKHByZXYpIHtcblx0XHRwcmV2Lm5leHQgPSBub2RlO1xuXHRcdG5vZGUucHJldmlvdXMgPSBwcmV2O1xuXHR9IGVsc2Uge1xuXHRcdC8vIGlmIHRoZXJlIGlzIG5vdCBhIHByZXZpb3VzIG5vZGUsIHdlIGFyZSBpbnNlcnRpbmcgYSBuZXcgZmlyc3Qgbm9kZSwgdGh1cyBcblx0XHQvLyBoZWFkIG11c3QgYmUgbW9kaWZpZWRcblx0XHR0aGlzLmhlYWQgPSBub2RlO1xuXHR9XG5cblxuXHR0aGlzLl9sZW5ndGgrKztcblx0cmV0dXJuIG5vZGU7XG5cbn07XG5cblxuLyoqXG4gKiBSZW1vdmVzIG5vZGVzIHNwZWNpZmllZCBieSB0aGUgcGFyYW1ldGVyXG4gKiBAcGFyYW0gIHtOb2RlfSBub2RlIE5vZGUgdG8gcmVtb3ZlXG4gKiBAcmV0dXJuIHtOb2RlfSAgICAgIHJlbW92ZWQgbm9kZVxuICovXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmVOb2RlID0gZnVuY3Rpb24obm9kZSkge1xuXHRpZiAoIShub2RlIGluc3RhbmNlb2YgTm9kZSkpXG5cdFx0dGhyb3cgbmV3IEVycm9yKCdyZW1vdmVOb2RlOiBleHBlY3RpbmcgYSBOb2RlIGFzIHBhcmFtZXRlciB0eXBlJyk7XG5cblx0dmFyIG5leHQgPSBub2RlLm5leHQ7XG5cdHZhciBwcmV2ID0gbm9kZS5wcmV2aW91cztcblxuXHQvL3RoaXMgY291bGQgYmUgdGhlIGxhc3Qgbm9kZVxuXHRpZiAobmV4dClcblx0XHRuZXh0LnByZXZpb3VzID0gcHJldjtcblxuXHQvL2NvdWxkIGJlIHRoZSBmaXJzdCBub2RlXG5cdGlmIChwcmV2KVxuXHRcdHByZXYubmV4dCA9IG5leHQ7XG5cdGVsc2Vcblx0XHR0aGlzLmhlYWQgPSBuZXh0O1xuXG5cdHZhciBub2RlVG9SZW1vdmUgPSBub2RlO1xuXHRub2RlID0gbnVsbDtcblxuXHR0aGlzLl9sZW5ndGgtLTtcblxuXHRyZXR1cm4gbm9kZVRvUmVtb3ZlO1xuXG59O1xuXG5cbi8qKlxuICogUmV0dXJucyBjdXJyZW50IGxlbmd0aCBvZiB0aGUgbGlua2VkIGxpc3RcbiAqL1xuTGlua2VkTGlzdC5wcm90b3R5cGUubGVuZ3RoID0gZnVuY3Rpb24oKSB7XG5cdHJldHVybiB0aGlzLl9sZW5ndGg7XG59O1xuXG5cbi8qKlxuICogR2V0cyBhbGwgbm9kZXMgY3VycmVudGx5IGluIHRoZSBsaXN0XG4gKiBAcmV0dXJucyB7QXJyYXl9IGFycmF5IG9mIGFsbCBub2RlcyBpbiB0aGUgbGlzdFxuICovXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRBbGxOb2RlcyA9IGZ1bmN0aW9uKCkge1xuXHR2YXIgcmVzdWx0ID0gW107XG5cblx0dmFyIGN1cnJlbnROb2RlID0gdGhpcy5oZWFkO1xuXG5cdHdoaWxlIChjdXJyZW50Tm9kZSkge1xuXHRcdHJlc3VsdC5wdXNoKGN1cnJlbnROb2RlKTtcblx0XHRjdXJyZW50Tm9kZSA9IGN1cnJlbnROb2RlLm5leHQ7XG5cdH1cblxuXG5cdHJldHVybiByZXN1bHQ7XG59O1xuXG5cblxuLyoqXG4gKiBHYXRoZXJzIGRhdGEgZnJvbSBhbGwgbm9kZXMgaW50byBhbiBhcnJheVxuICogQHJldHVybnMge0FycmF5fSBhcnJheSBvZiBhbGwgbm9kZXMgaW4gdGhlIGxpc3RcbiAqL1xuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0RGF0YUFycmF5ID0gZnVuY3Rpb24oKSB7XG5cdHZhciByZXN1bHQgPSBbXTtcblxuXHR2YXIgY3VycmVudE5vZGUgPSB0aGlzLmhlYWQ7XG5cblx0d2hpbGUgKGN1cnJlbnROb2RlKSB7XG5cdFx0cmVzdWx0LnB1c2goY3VycmVudE5vZGUuZGF0YSk7XG5cdFx0Y3VycmVudE5vZGUgPSBjdXJyZW50Tm9kZS5uZXh0O1xuXHR9XG5cblxuXHRyZXR1cm4gcmVzdWx0O1xufTtcblxuXG5cbi8qKlxuICogR2V0IG5vZGUgYXQgdGhlIHNwZWNpZmllZCBwb3NpdGlvblxuICogQHBhcmFtICB7TnVtYmVyfSBwb3NpdGlvbiBwb3NpdGlvbiB0byBnZXQgbm9kZSBhdFxuICogQHJldHVybiB7Tm9kZX0gICAgICAgICAgTm9kZSBhdCBzcGVjaWZpZWQgcG9zaXRpb25cbiAqL1xuTGlua2VkTGlzdC5wcm90b3R5cGUuc2VhcmNoTm9kZUF0ID0gZnVuY3Rpb24ocG9zaXRpb24pIHtcblx0dmFyIGN1cnJlbnROb2RlID0gdGhpcy5oZWFkLFxuXHRcdGxlbmd0aCA9IHRoaXMuX2xlbmd0aCxcblx0XHRjb3VudCA9IDEsXG5cdFx0bWVzc2FnZSA9IHtcblx0XHRcdGZhaWx1cmU6ICdGYWlsdXJlOiBub24tZXhpc3RlbnQgbm9kZSBpbiB0aGlzIGxpc3QuJ1xuXHRcdH07XG5cblx0Ly8gMXN0IHVzZS1jYXNlOiBhbiBpbnZhbGlkIHBvc2l0aW9uXG5cdGlmIChsZW5ndGggPT09IDAgfHwgcG9zaXRpb24gPCAxIHx8IHBvc2l0aW9uID4gbGVuZ3RoKSB7XG5cdFx0dGhyb3cgbmV3IEVycm9yKG1lc3NhZ2UuZmFpbHVyZSk7XG5cdH1cblxuXHQvLyAybmQgdXNlLWNhc2U6IGEgdmFsaWQgcG9zaXRpb25cblx0d2hpbGUgKGNvdW50IDwgcG9zaXRpb24pIHtcblx0XHRjdXJyZW50Tm9kZSA9IGN1cnJlbnROb2RlLm5leHQ7XG5cdFx0Y291bnQrKztcblx0fVxuXG5cdHJldHVybiBjdXJyZW50Tm9kZTtcbn07XG5cblxuXG4vKipcbiAqIFJlbW92ZXMgbm9kZSBhdCBzcGVjaWZpZWQgcG9zaXRpb25cbiAqIEBwYXJhbSAge051bWJlcn0gcG9zaXRpb24gbm9kZSBhdCB0aGlzIHBvc2l0aW9uIHdpbGwgYmUgZGVsZXRlZFxuICogQHJldHVybiB7T2JqZWN0fSAgICAgICAgICBEZWxldGVkIG5vZGVcbiAqL1xuTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocG9zaXRpb24pIHtcblx0dmFyIGN1cnJlbnROb2RlID0gdGhpcy5oZWFkLFxuXHRcdGxlbmd0aCA9IHRoaXMuX2xlbmd0aCxcblx0XHRjb3VudCA9IDEsXG5cdFx0bWVzc2FnZSA9IHtcblx0XHRcdGZhaWx1cmU6ICdGYWlsdXJlOiBub24tZXhpc3RlbnQgbm9kZSBpbiB0aGlzIGxpc3QuJ1xuXHRcdH0sXG5cdFx0YmVmb3JlTm9kZVRvRGVsZXRlID0gbnVsbCxcblx0XHRub2RlVG9EZWxldGUgPSBudWxsLFxuXHRcdGRlbGV0ZWROb2RlID0gbnVsbDtcblxuXHQvLyAxc3QgdXNlLWNhc2U6IGFuIGludmFsaWQgcG9zaXRpb25cblx0aWYgKGxlbmd0aCA9PT0gMCB8fCBwb3NpdGlvbiA8IDEgfHwgcG9zaXRpb24gPiBsZW5ndGgpIHtcblx0XHR0aHJvdyBuZXcgRXJyb3IobWVzc2FnZS5mYWlsdXJlKTtcblx0fVxuXG5cdC8vIDJuZCB1c2UtY2FzZTogdGhlIGZpcnN0IG5vZGUgaXMgcmVtb3ZlZFxuXHRpZiAocG9zaXRpb24gPT09IDEpIHtcblx0XHR0aGlzLmhlYWQgPSBjdXJyZW50Tm9kZS5uZXh0O1xuXHRcdGRlbGV0ZWROb2RlID0gY3VycmVudE5vZGU7XG5cblx0XHQvLyAybmQgdXNlLWNhc2U6IHRoZXJlIGlzIGEgc2Vjb25kIG5vZGVcblx0XHRpZiAoIXRoaXMuaGVhZCkge1xuXHRcdFx0dGhpcy5oZWFkLnByZXZpb3VzID0gbnVsbDtcblx0XHRcdC8vIDJuZCB1c2UtY2FzZTogdGhlcmUgaXMgbm8gc2Vjb25kIG5vZGVcblx0XHR9IGVsc2Uge1xuXHRcdFx0dGhpcy50YWlsID0gbnVsbDtcblx0XHR9XG5cblx0XHR0aGlzLl9sZW5ndGgtLTtcblxuXHRcdHJldHVybiBkZWxldGVkTm9kZTtcblxuXHR9XG5cblx0Ly8gM3JkIHVzZS1jYXNlOiB0aGUgbGFzdCBub2RlIGlzIHJlbW92ZWRcblx0aWYgKHBvc2l0aW9uID09PSB0aGlzLl9sZW5ndGgpIHtcblx0XHRkZWxldGVkTm9kZSA9IHRoaXMudGFpbDtcblx0XHR0aGlzLnRhaWwgPSB0aGlzLnRhaWwucHJldmlvdXM7XG5cdFx0dGhpcy50YWlsLm5leHQgPSBudWxsO1xuXG5cdFx0dGhpcy5fbGVuZ3RoLS07XG5cdFx0cmV0dXJuIGRlbGV0ZWROb2RlO1xuXG5cdH1cblxuXHQvLyA0dGggdXNlLWNhc2U6IGEgbWlkZGxlIG5vZGUgaXMgcmVtb3ZlZFxuXG5cdHdoaWxlIChjb3VudCA8IHBvc2l0aW9uKSB7XG5cdFx0Y3VycmVudE5vZGUgPSBjdXJyZW50Tm9kZS5uZXh0O1xuXHRcdGNvdW50Kys7XG5cdH1cblxuXHRiZWZvcmVOb2RlVG9EZWxldGUgPSBjdXJyZW50Tm9kZS5wcmV2aW91cztcblx0bm9kZVRvRGVsZXRlID0gY3VycmVudE5vZGU7XG5cdHZhciBhZnRlck5vZGVUb0RlbGV0ZSA9IGN1cnJlbnROb2RlLm5leHQ7XG5cblx0YmVmb3JlTm9kZVRvRGVsZXRlLm5leHQgPSBhZnRlck5vZGVUb0RlbGV0ZTtcblx0YWZ0ZXJOb2RlVG9EZWxldGUucHJldmlvdXMgPSBiZWZvcmVOb2RlVG9EZWxldGU7XG5cdGRlbGV0ZWROb2RlID0gbm9kZVRvRGVsZXRlO1xuXHRub2RlVG9EZWxldGUgPSBudWxsO1xuXG5cblx0dGhpcy5fbGVuZ3RoLS07XG5cblx0cmV0dXJuIGRlbGV0ZWROb2RlO1xufTtcblxuXG52YXIgZmFjdG9yeSA9IHt9O1xuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgbGlua2VkIGxpc3RcbiAqL1xuZmFjdG9yeS5tYWtlTGlua2VkTGlzdCA9IGZ1bmN0aW9uKCkge1xuXHRyZXR1cm4gbmV3IExpbmtlZExpc3QoKTtcbn07XG5cblxubW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5OyIsInZhciBGYXN0TWF0aCA9IHJlcXVpcmUoJy4vZmFzdE1hdGgnKTtcbnZhciBmYWN0b3J5ID0ge307XG5cblxuLyoqXG4gKiBQb2x5bm9taWFsIG9mIG1heCAzcmQgZGVncmVlXG4gKiBAcGFyYW0ge0FycmF5fSBjb2VmZkFycmF5IFtkZXNjcmlwdGlvbl1cbiAqIEBwYXJhbSB7ZG91YmxlfSBzdGFydFBvaW50IFBvaW50IG9uIHRoZSBYLWF4aXMgd2hlcmUgdG8gc3RhcnQgZXZhbHVhdGluZ1xuICogQHBhcmFtIHtkb3VibGV9IGVuZFBvaW50IHdoZXJlIG9uIHgtYXhpcyBkb2VzIHRoZSBldmFsdWF0aW9uIHN0b3BcbiAqL1xudmFyIFBvbHlub21pYWwgPSBmdW5jdGlvbihjb2VmZkFycmF5LCBzdGFydFBvaW50LCBlbmRQb2ludCkge1xuXG4gICAgdGhpcy5BID0gY29lZmZBcnJheVszXTtcbiAgICB0aGlzLkIgPSBjb2VmZkFycmF5WzJdO1xuICAgIHRoaXMuQyA9IGNvZWZmQXJyYXlbMV07XG4gICAgdGhpcy5EID0gY29lZmZBcnJheVswXTtcbiAgICB0aGlzLnN0YXJ0UG9pbnQgPSBzdGFydFBvaW50O1xuICAgIHRoaXMuZW5kUG9pbnQgPSBlbmRQb2ludDtcblxufTtcblxuXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5ldmFsdWF0ZUF0ID0gZnVuY3Rpb24oeCkge1xuICAgIGlmIChGYXN0TWF0aC5sdCh4LCB0aGlzLnN0YXJ0UG9pbnQpKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RyeWluZyB0byBldmFsdXRlIHBvbHlub21pYWwgd2l0aCB4IHZhbHVlIGxlc3MgdGhhbiB0aGUgc3RhcnQgcG9pbnQnKTtcbiAgICBpZiAoRmFzdE1hdGguZ3QoeCwgdGhpcy5lbmRQb2ludCkpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVHJ5aW5nIHRvIGV2YWx1YXRlIHBvbHlub21pYWwgd2l0aCB4IHZhbHVlIGdyZWF0ZXIgdGhhbiB0aGUgZW5kIHBvaW50Jyk7XG4gICAgcmV0dXJuIHRoaXMuQSAqIE1hdGgucG93KHggLSB0aGlzLnN0YXJ0UG9pbnQsIDMpICsgdGhpcy5CICogTWF0aC5wb3coeCAtIHRoaXMuc3RhcnRQb2ludCwgMikgKyB0aGlzLkMgKiAoeCAtIHRoaXMuc3RhcnRQb2ludCkgKyB0aGlzLkQ7XG59O1xuXG5cbi8qKlxuICogVGFrZXMgZGVyaXZhdGl2ZSBvZiB0aGlzIHBvbHlub21pYWwgYW5kIHJldHVybnMgYSBuZXcgcG9seW5vbWlhbFxuICogQHJldHVybnMge1BvbHlub21pYWx9IGEgbmV3IHBvbHlub21pYWxcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZGVyaXZhdGl2ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBiID0gMyAqIHRoaXMuQTtcbiAgICB2YXIgYyA9IDIgKiB0aGlzLkI7XG4gICAgdmFyIGQgPSB0aGlzLkM7XG5cbiAgICByZXR1cm4gbmV3IFBvbHlub21pYWwoW2QsIGMsIGIsIDBdLCB0aGlzLnN0YXJ0UG9pbnQsIHRoaXMuZW5kUG9pbnQpO1xufTtcblxuLyoqXG4gKiBDYWxjdWxhdGUgY3ViaWMgcm9vdHMgLSBwcm9wcyB0byBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8yNzE3NjQyNC8xNTc5Nzc4XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnJvb3RzID0gZnVuY3Rpb24oKSB7XG5cbiAgICB2YXIgdGhhdCA9IHRoaXM7XG4gICAgdmFyIHJvb3RzID0gY2FsY3VsYXRlQ3ViaWNSb290cyh0aGlzLkEsIHRoaXMuQiwgdGhpcy5DLCB0aGlzLkQpO1xuICAgIHJldHVybiByb290cy5maWx0ZXIoZnVuY3Rpb24odmFsdWUpIHtcblxuICAgICAgICBpZiAoRmFzdE1hdGguZ2VxKHZhbHVlLCB0aGF0LnN0YXJ0UG9pbnQpICYmIEZhc3RNYXRoLmxlcSh2YWx1ZSwgdGhhdC5lbmRQb2ludCkpXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcblxufTtcblxuXG5cblBvbHlub21pYWwucHJvdG90eXBlLnRvUHJldHR5U3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMudGhpcy5BICsgJyh4LScgKyB0aGlzLnN0YXJ0UG9pbnQgKyAnKV4zICsgJyArIHRoaXMuQiArICcoeC0nICsgdGhpcy5zdGFydFBvaW50ICsgJyleMiArICcgKyB0aGlzLkMgKyAnKHgtJyArIHRoaXMuc3RhcnRQb2ludCArICcpJyArIHRoaXMuRDtcbn07XG5cblxuXG52YXIgY3ViZXJvb3QgPSBmdW5jdGlvbiBjdWJlcm9vdCh4KSB7XG4gICAgdmFyIHkgPSBNYXRoLnBvdyhNYXRoLmFicyh4KSwgMSAvIDMpO1xuICAgIHJldHVybiB4IDwgMCA/IC15IDogeTtcbn07XG5cblxudmFyIGNhbGN1bGF0ZUN1YmljUm9vdHMgPSBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgdmFyIEQ7XG4gICAgdmFyIHU7XG5cbiAgICBpZiAoTWF0aC5hYnMoYSkgPCAxZS04KSB7IC8vIFF1YWRyYXRpYyBjYXNlLCBheF4yK2J4K2M9MFxuICAgICAgICBhID0gYjtcbiAgICAgICAgYiA9IGM7XG4gICAgICAgIGMgPSBkO1xuICAgICAgICBpZiAoTWF0aC5hYnMoYSkgPCAxZS04KSB7IC8vIExpbmVhciBjYXNlLCBheCtiPTBcbiAgICAgICAgICAgIGEgPSBiO1xuICAgICAgICAgICAgYiA9IGM7XG4gICAgICAgICAgICBpZiAoTWF0aC5hYnMoYSkgPCAxZS04KSAvLyBEZWdlbmVyYXRlIGNhc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICByZXR1cm4gWy1iIC8gYV07XG4gICAgICAgIH1cblxuICAgICAgICBEID0gYiAqIGIgLSA0ICogYSAqIGM7XG4gICAgICAgIGlmIChNYXRoLmFicyhEKSA8IDFlLTgpXG4gICAgICAgICAgICByZXR1cm4gWy1iIC8gKDIgKiBhKV07XG4gICAgICAgIGVsc2UgaWYgKEQgPiAwKVxuICAgICAgICAgICAgcmV0dXJuIFsoLWIgKyBNYXRoLnNxcnQoRCkpIC8gKDIgKiBhKSwgKC1iIC0gTWF0aC5zcXJ0KEQpKSAvICgyICogYSldO1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLy8gQ29udmVydCB0byBkZXByZXNzZWQgY3ViaWMgdF4zK3B0K3EgPSAwIChzdWJzdCB4ID0gdCAtIGIvM2EpXG4gICAgdmFyIHAgPSAoMyAqIGEgKiBjIC0gYiAqIGIpIC8gKDMgKiBhICogYSk7XG4gICAgdmFyIHEgPSAoMiAqIGIgKiBiICogYiAtIDkgKiBhICogYiAqIGMgKyAyNyAqIGEgKiBhICogZCkgLyAoMjcgKiBhICogYSAqIGEpO1xuICAgIHZhciByb290cztcblxuICAgIGlmIChNYXRoLmFicyhwKSA8IDFlLTgpIHsgLy8gcCA9IDAgLT4gdF4zID0gLXEgLT4gdCA9IC1xXjEvM1xuICAgICAgICByb290cyA9IFtjdWJlcm9vdCgtcSldO1xuICAgIH0gZWxzZSBpZiAoTWF0aC5hYnMocSkgPCAxZS04KSB7IC8vIHEgPSAwIC0+IHReMyArIHB0ID0gMCAtPiB0KHReMitwKT0wXG4gICAgICAgIHJvb3RzID0gWzBdLmNvbmNhdChwIDwgMCA/IFtNYXRoLnNxcnQoLXApLCAtTWF0aC5zcXJ0KC1wKV0gOiBbXSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgRCA9IHEgKiBxIC8gNCArIHAgKiBwICogcCAvIDI3O1xuICAgICAgICBpZiAoTWF0aC5hYnMoRCkgPCAxZS04KSB7IC8vIEQgPSAwIC0+IHR3byByb290c1xuICAgICAgICAgICAgcm9vdHMgPSBbLTEuNSAqIHEgLyBwLCAzICogcSAvIHBdO1xuICAgICAgICB9IGVsc2UgaWYgKEQgPiAwKSB7IC8vIE9ubHkgb25lIHJlYWwgcm9vdFxuICAgICAgICAgICAgdSA9IGN1YmVyb290KC1xIC8gMiAtIE1hdGguc3FydChEKSk7XG4gICAgICAgICAgICByb290cyA9IFt1IC0gcCAvICgzICogdSldO1xuICAgICAgICB9IGVsc2UgeyAvLyBEIDwgMCwgdGhyZWUgcm9vdHMsIGJ1dCBuZWVkcyB0byB1c2UgY29tcGxleCBudW1iZXJzL3RyaWdvbm9tZXRyaWMgc29sdXRpb25cbiAgICAgICAgICAgIHUgPSAyICogTWF0aC5zcXJ0KC1wIC8gMyk7XG4gICAgICAgICAgICB2YXIgdCA9IE1hdGguYWNvcygzICogcSAvIHAgLyB1KSAvIDM7IC8vIEQgPCAwIGltcGxpZXMgcCA8IDAgYW5kIGFjb3MgYXJndW1lbnQgaW4gWy0xLi4xXVxuICAgICAgICAgICAgdmFyIGsgPSAyICogTWF0aC5QSSAvIDM7XG4gICAgICAgICAgICByb290cyA9IFt1ICogTWF0aC5jb3ModCksIHUgKiBNYXRoLmNvcyh0IC0gayksIHUgKiBNYXRoLmNvcyh0IC0gMiAqIGspXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvbnZlcnQgYmFjayBmcm9tIGRlcHJlc3NlZCBjdWJpY1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKyspXG4gICAgICAgIHJvb3RzW2ldIC09IGIgLyAoMyAqIGEpO1xuXG5cblxuICAgIHJldHVybiByb290cztcbn07XG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgIHBvbHlub21pYWwgd2l0aCBjb2VmZmljaWVudHMgQSxCLEMsRFxuICogQXheMyArIEJ4XjIgKyBDeCArRFxuICogQHBhcmFtIHtBcnJheX0gY29lZmZzIFthcnJheSBvZiBjb2VmZmljaWVudHNdXG4gKiBAcGFyYW0ge2RvdWJsZX0gc3RhcnRQb2ludCB3aGVyZSBvbiB4LWF4aXMgZG9lcyB0aGlzIHBvbHkgc3RhcnRcbiAqIEBwYXJhbSB7ZG91YmxlfSBlbmRQb2ludCB3aGVyZSBvbiBhIHgtYXhpcyBkb2VzIHRoaXMgcG9seSBlbmRcbiAqL1xuZmFjdG9yeS5jcmVhdGVQb2x5QWJDZCA9IGZ1bmN0aW9uKGNvZWZmcywgc3RhcnRQb2ludCwgZW5kUG9pbnQpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29lZmZzKSB8fCBjb2VmZnMubGVuZ3RoICE9IDQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIHBhcmFtZXRlciBvZiB0eXBlIGFycmF5IGFuZCBsZW5ndGggNCcpO1xuXG4gICAgaWYgKCFGYXN0TWF0aC5pc051bWVyaWMoc3RhcnRQb2ludCkgfHwgc3RhcnRQb2ludCA8IDApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIGEgdmFsaWQgc3RhcnRwb2ludCcpO1xuXG4gICAgaWYgKCFGYXN0TWF0aC5pc051bWVyaWMoZW5kUG9pbnQpIHx8IGVuZFBvaW50IDw9IHN0YXJ0UG9pbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignZXhwZWN0aW5nIHZhbGlkIGVuZHBvaW50Jyk7XG5cblxuXG4gICAgdmFyIHBvbHkgPSBuZXcgUG9seW5vbWlhbChjb2VmZnMucmV2ZXJzZSgpLCBzdGFydFBvaW50LCBlbmRQb2ludCk7XG5cbiAgICByZXR1cm4gcG9seTtcblxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5OyIsIiAgICB2YXIgVW5kb01hbmFnZXIgPSByZXF1aXJlKCd1bmRvLW1hbmFnZXInKTsgLy8gcmVxdWlyZSB0aGUgbGliIGZyb20gbm9kZV9tb2R1bGVzXG4gICAgdmFyIHNpbmdsZXRvbjtcblxuICAgIGlmICghc2luZ2xldG9uKSB7XG4gICAgICAgIHNpbmdsZXRvbiA9IG5ldyBVbmRvTWFuYWdlcigpO1xuICAgIH1cblxuICAgIG1vZHVsZS5leHBvcnRzID0gc2luZ2xldG9uOyIsIlx0LyoqXG5cdCAqIE9iamVjdCBFeHRlbmRpbmcgRnVuY3Rpb25hbGl0eVxuXHQgKiBodHRwczovL2dpc3QuZ2l0aHViLmNvbS9iaGF2eWF3LzI1YjExNTYwMzYzMGViZjIyNzFkXG5cdCAqL1xuXHR2YXIgZXh0ZW5kID0gZnVuY3Rpb24ob3V0KSB7XG5cdFx0ICBvdXQgPSBvdXQgfHwge307XG5cdFx0ICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuXHRcdCAgICBpZiAoIWFyZ3VtZW50c1tpXSlcblx0XHQgICAgICBjb250aW51ZTtcblxuXHRcdCAgICBmb3IgKHZhciBrZXkgaW4gYXJndW1lbnRzW2ldKSB7XG5cdFx0ICAgICAgaWYgKGFyZ3VtZW50c1tpXS5oYXNPd25Qcm9wZXJ0eShrZXkpKVxuXHRcdCAgICAgICAgb3V0W2tleV0gPSBhcmd1bWVudHNbaV1ba2V5XTtcblx0XHQgICAgfVxuXHRcdCAgfVxuXHRcdCAgcmV0dXJuIG91dDtcblx0fTtcblxuXHQvLyBleHBvcnQgQ29tbW9uSlMgd2F5XG5cdGV4cG9ydHMuZXh0ZW5kPWV4dGVuZDtcblxuXHQvKipcblx0ICogYW5ndWxhciBpc09iamVjdCBzaGltXG5cdCAqIEBwYXJhbSAge09iamVjdH0gIG9iaiBvYmplY3QgdG8gY2hlY2tcblx0ICogQHJldHVybiB7Qm9vbGVhbn0gICAgIHRydWUgaWYgb2JqZWN0XG5cdCAqL1xuXHR2YXIgaXNPYmplY3QgPSBmdW5jdGlvbihvYmopIHtcblx0XHRyZXR1cm4gb2JqICE9PSBudWxsICYmIHR5cGVvZiBvYmogPT09J29iamVjdCc7XG5cdH07XG5cblx0ZXhwb3J0cy5pc09iamVjdCA9IGlzT2JqZWN0O1xuXG5cblx0LyoqXG5cdCAqIE1pbWljcyBhbmd1bGFyIGlzVW5kZWZpbmVkIGZ1bmN0aW9uYWxpdHlcblx0ICogQHBhcmFtICB7T2JqZWN0fSAgb2JqIG9iamVjdCB0byB0ZXN0XG5cdCAqIEByZXR1cm4ge0Jvb2xlYW59ICAgICB0cnVlIGlmIHVuZWZpbmVkXG5cdCAqL1xuXHR2YXIgaXNVbmRlZmluZWQgPSBmdW5jdGlvbihvYmopIHtcblx0XHRyZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCc7XG5cdH1cblx0ZXhwb3J0cy5pc1VuZGVmaW5lZD1pc1VuZGVmaW5lZDsiLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIG51bWVyaWMgPSAodHlwZW9mIGV4cG9ydHMgPT09IFwidW5kZWZpbmVkXCIpPyhmdW5jdGlvbiBudW1lcmljKCkge30pOihleHBvcnRzKTtcbmlmKHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIpIHsgZ2xvYmFsLm51bWVyaWMgPSBudW1lcmljOyB9XG5cbm51bWVyaWMudmVyc2lvbiA9IFwiMS4yLjZcIjtcblxuLy8gMS4gVXRpbGl0eSBmdW5jdGlvbnNcbm51bWVyaWMuYmVuY2ggPSBmdW5jdGlvbiBiZW5jaCAoZixpbnRlcnZhbCkge1xuICAgIHZhciB0MSx0MixuLGk7XG4gICAgaWYodHlwZW9mIGludGVydmFsID09PSBcInVuZGVmaW5lZFwiKSB7IGludGVydmFsID0gMTU7IH1cbiAgICBuID0gMC41O1xuICAgIHQxID0gbmV3IERhdGUoKTtcbiAgICB3aGlsZSgxKSB7XG4gICAgICAgIG4qPTI7XG4gICAgICAgIGZvcihpPW47aT4zO2ktPTQpIHsgZigpOyBmKCk7IGYoKTsgZigpOyB9XG4gICAgICAgIHdoaWxlKGk+MCkgeyBmKCk7IGktLTsgfVxuICAgICAgICB0MiA9IG5ldyBEYXRlKCk7XG4gICAgICAgIGlmKHQyLXQxID4gaW50ZXJ2YWwpIGJyZWFrO1xuICAgIH1cbiAgICBmb3IoaT1uO2k+MztpLT00KSB7IGYoKTsgZigpOyBmKCk7IGYoKTsgfVxuICAgIHdoaWxlKGk+MCkgeyBmKCk7IGktLTsgfVxuICAgIHQyID0gbmV3IERhdGUoKTtcbiAgICByZXR1cm4gMTAwMCooMypuLTEpLyh0Mi10MSk7XG59XG5cbm51bWVyaWMuX215SW5kZXhPZiA9IChmdW5jdGlvbiBfbXlJbmRleE9mKHcpIHtcbiAgICB2YXIgbiA9IHRoaXMubGVuZ3RoLGs7XG4gICAgZm9yKGs9MDtrPG47KytrKSBpZih0aGlzW2tdPT09dykgcmV0dXJuIGs7XG4gICAgcmV0dXJuIC0xO1xufSk7XG5udW1lcmljLm15SW5kZXhPZiA9IChBcnJheS5wcm90b3R5cGUuaW5kZXhPZik/QXJyYXkucHJvdG90eXBlLmluZGV4T2Y6bnVtZXJpYy5fbXlJbmRleE9mO1xuXG5udW1lcmljLkZ1bmN0aW9uID0gRnVuY3Rpb247XG5udW1lcmljLnByZWNpc2lvbiA9IDQ7XG5udW1lcmljLmxhcmdlQXJyYXkgPSA1MDtcblxubnVtZXJpYy5wcmV0dHlQcmludCA9IGZ1bmN0aW9uIHByZXR0eVByaW50KHgpIHtcbiAgICBmdW5jdGlvbiBmbXRudW0oeCkge1xuICAgICAgICBpZih4ID09PSAwKSB7IHJldHVybiAnMCc7IH1cbiAgICAgICAgaWYoaXNOYU4oeCkpIHsgcmV0dXJuICdOYU4nOyB9XG4gICAgICAgIGlmKHg8MCkgeyByZXR1cm4gJy0nK2ZtdG51bSgteCk7IH1cbiAgICAgICAgaWYoaXNGaW5pdGUoeCkpIHtcbiAgICAgICAgICAgIHZhciBzY2FsZSA9IE1hdGguZmxvb3IoTWF0aC5sb2coeCkgLyBNYXRoLmxvZygxMCkpO1xuICAgICAgICAgICAgdmFyIG5vcm1hbGl6ZWQgPSB4IC8gTWF0aC5wb3coMTAsc2NhbGUpO1xuICAgICAgICAgICAgdmFyIGJhc2ljID0gbm9ybWFsaXplZC50b1ByZWNpc2lvbihudW1lcmljLnByZWNpc2lvbik7XG4gICAgICAgICAgICBpZihwYXJzZUZsb2F0KGJhc2ljKSA9PT0gMTApIHsgc2NhbGUrKzsgbm9ybWFsaXplZCA9IDE7IGJhc2ljID0gbm9ybWFsaXplZC50b1ByZWNpc2lvbihudW1lcmljLnByZWNpc2lvbik7IH1cbiAgICAgICAgICAgIHJldHVybiBwYXJzZUZsb2F0KGJhc2ljKS50b1N0cmluZygpKydlJytzY2FsZS50b1N0cmluZygpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnSW5maW5pdHknO1xuICAgIH1cbiAgICB2YXIgcmV0ID0gW107XG4gICAgZnVuY3Rpb24gZm9vKHgpIHtcbiAgICAgICAgdmFyIGs7XG4gICAgICAgIGlmKHR5cGVvZiB4ID09PSBcInVuZGVmaW5lZFwiKSB7IHJldC5wdXNoKEFycmF5KG51bWVyaWMucHJlY2lzaW9uKzgpLmpvaW4oJyAnKSk7IHJldHVybiBmYWxzZTsgfVxuICAgICAgICBpZih0eXBlb2YgeCA9PT0gXCJzdHJpbmdcIikgeyByZXQucHVzaCgnXCInK3grJ1wiJyk7IHJldHVybiBmYWxzZTsgfVxuICAgICAgICBpZih0eXBlb2YgeCA9PT0gXCJib29sZWFuXCIpIHsgcmV0LnB1c2goeC50b1N0cmluZygpKTsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICAgIGlmKHR5cGVvZiB4ID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgICB2YXIgYSA9IGZtdG51bSh4KTtcbiAgICAgICAgICAgIHZhciBiID0geC50b1ByZWNpc2lvbihudW1lcmljLnByZWNpc2lvbik7XG4gICAgICAgICAgICB2YXIgYyA9IHBhcnNlRmxvYXQoeC50b1N0cmluZygpKS50b1N0cmluZygpO1xuICAgICAgICAgICAgdmFyIGQgPSBbYSxiLGMscGFyc2VGbG9hdChiKS50b1N0cmluZygpLHBhcnNlRmxvYXQoYykudG9TdHJpbmcoKV07XG4gICAgICAgICAgICBmb3Ioaz0xO2s8ZC5sZW5ndGg7aysrKSB7IGlmKGRba10ubGVuZ3RoIDwgYS5sZW5ndGgpIGEgPSBkW2tdOyB9XG4gICAgICAgICAgICByZXQucHVzaChBcnJheShudW1lcmljLnByZWNpc2lvbis4LWEubGVuZ3RoKS5qb2luKCcgJykrYSk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYoeCA9PT0gbnVsbCkgeyByZXQucHVzaChcIm51bGxcIik7IHJldHVybiBmYWxzZTsgfVxuICAgICAgICBpZih0eXBlb2YgeCA9PT0gXCJmdW5jdGlvblwiKSB7IFxuICAgICAgICAgICAgcmV0LnB1c2goeC50b1N0cmluZygpKTtcbiAgICAgICAgICAgIHZhciBmbGFnID0gZmFsc2U7XG4gICAgICAgICAgICBmb3IoayBpbiB4KSB7IGlmKHguaGFzT3duUHJvcGVydHkoaykpIHsgXG4gICAgICAgICAgICAgICAgaWYoZmxhZykgcmV0LnB1c2goJyxcXG4nKTtcbiAgICAgICAgICAgICAgICBlbHNlIHJldC5wdXNoKCdcXG57Jyk7XG4gICAgICAgICAgICAgICAgZmxhZyA9IHRydWU7IFxuICAgICAgICAgICAgICAgIHJldC5wdXNoKGspOyBcbiAgICAgICAgICAgICAgICByZXQucHVzaCgnOiBcXG4nKTsgXG4gICAgICAgICAgICAgICAgZm9vKHhba10pOyBcbiAgICAgICAgICAgIH0gfVxuICAgICAgICAgICAgaWYoZmxhZykgcmV0LnB1c2goJ31cXG4nKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmKHggaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgICAgICAgaWYoeC5sZW5ndGggPiBudW1lcmljLmxhcmdlQXJyYXkpIHsgcmV0LnB1c2goJy4uLkxhcmdlIEFycmF5Li4uJyk7IHJldHVybiB0cnVlOyB9XG4gICAgICAgICAgICB2YXIgZmxhZyA9IGZhbHNlO1xuICAgICAgICAgICAgcmV0LnB1c2goJ1snKTtcbiAgICAgICAgICAgIGZvcihrPTA7azx4Lmxlbmd0aDtrKyspIHsgaWYoaz4wKSB7IHJldC5wdXNoKCcsJyk7IGlmKGZsYWcpIHJldC5wdXNoKCdcXG4gJyk7IH0gZmxhZyA9IGZvbyh4W2tdKTsgfVxuICAgICAgICAgICAgcmV0LnB1c2goJ10nKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldC5wdXNoKCd7Jyk7XG4gICAgICAgIHZhciBmbGFnID0gZmFsc2U7XG4gICAgICAgIGZvcihrIGluIHgpIHsgaWYoeC5oYXNPd25Qcm9wZXJ0eShrKSkgeyBpZihmbGFnKSByZXQucHVzaCgnLFxcbicpOyBmbGFnID0gdHJ1ZTsgcmV0LnB1c2goayk7IHJldC5wdXNoKCc6IFxcbicpOyBmb28oeFtrXSk7IH0gfVxuICAgICAgICByZXQucHVzaCgnfScpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgZm9vKHgpO1xuICAgIHJldHVybiByZXQuam9pbignJyk7XG59XG5cbm51bWVyaWMucGFyc2VEYXRlID0gZnVuY3Rpb24gcGFyc2VEYXRlKGQpIHtcbiAgICBmdW5jdGlvbiBmb28oZCkge1xuICAgICAgICBpZih0eXBlb2YgZCA9PT0gJ3N0cmluZycpIHsgcmV0dXJuIERhdGUucGFyc2UoZC5yZXBsYWNlKC8tL2csJy8nKSk7IH1cbiAgICAgICAgaWYoIShkIGluc3RhbmNlb2YgQXJyYXkpKSB7IHRocm93IG5ldyBFcnJvcihcInBhcnNlRGF0ZTogcGFyYW1ldGVyIG11c3QgYmUgYXJyYXlzIG9mIHN0cmluZ3NcIik7IH1cbiAgICAgICAgdmFyIHJldCA9IFtdLGs7XG4gICAgICAgIGZvcihrPTA7azxkLmxlbmd0aDtrKyspIHsgcmV0W2tdID0gZm9vKGRba10pOyB9XG4gICAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuICAgIHJldHVybiBmb28oZCk7XG59XG5cbm51bWVyaWMucGFyc2VGbG9hdCA9IGZ1bmN0aW9uIHBhcnNlRmxvYXRfKGQpIHtcbiAgICBmdW5jdGlvbiBmb28oZCkge1xuICAgICAgICBpZih0eXBlb2YgZCA9PT0gJ3N0cmluZycpIHsgcmV0dXJuIHBhcnNlRmxvYXQoZCk7IH1cbiAgICAgICAgaWYoIShkIGluc3RhbmNlb2YgQXJyYXkpKSB7IHRocm93IG5ldyBFcnJvcihcInBhcnNlRmxvYXQ6IHBhcmFtZXRlciBtdXN0IGJlIGFycmF5cyBvZiBzdHJpbmdzXCIpOyB9XG4gICAgICAgIHZhciByZXQgPSBbXSxrO1xuICAgICAgICBmb3Ioaz0wO2s8ZC5sZW5ndGg7aysrKSB7IHJldFtrXSA9IGZvbyhkW2tdKTsgfVxuICAgICAgICByZXR1cm4gcmV0O1xuICAgIH1cbiAgICByZXR1cm4gZm9vKGQpO1xufVxuXG5udW1lcmljLnBhcnNlQ1NWID0gZnVuY3Rpb24gcGFyc2VDU1YodCkge1xuICAgIHZhciBmb28gPSB0LnNwbGl0KCdcXG4nKTtcbiAgICB2YXIgaixrO1xuICAgIHZhciByZXQgPSBbXTtcbiAgICB2YXIgcGF0ID0gLygoW14nXCIsXSopfCgnW14nXSonKXwoXCJbXlwiXSpcIikpLC9nO1xuICAgIHZhciBwYXRudW0gPSAvXlxccyooKFsrLV0/WzAtOV0rKFxcLlswLTldKik/KGVbKy1dP1swLTldKyk/KXwoWystXT9bMC05XSooXFwuWzAtOV0rKT8oZVsrLV0/WzAtOV0rKT8pKVxccyokLztcbiAgICB2YXIgc3RyaXBwZXIgPSBmdW5jdGlvbihuKSB7IHJldHVybiBuLnN1YnN0cigwLG4ubGVuZ3RoLTEpOyB9XG4gICAgdmFyIGNvdW50ID0gMDtcbiAgICBmb3Ioaz0wO2s8Zm9vLmxlbmd0aDtrKyspIHtcbiAgICAgIHZhciBiYXIgPSAoZm9vW2tdK1wiLFwiKS5tYXRjaChwYXQpLGJhejtcbiAgICAgIGlmKGJhci5sZW5ndGg+MCkge1xuICAgICAgICAgIHJldFtjb3VudF0gPSBbXTtcbiAgICAgICAgICBmb3Ioaj0wO2o8YmFyLmxlbmd0aDtqKyspIHtcbiAgICAgICAgICAgICAgYmF6ID0gc3RyaXBwZXIoYmFyW2pdKTtcbiAgICAgICAgICAgICAgaWYocGF0bnVtLnRlc3QoYmF6KSkgeyByZXRbY291bnRdW2pdID0gcGFyc2VGbG9hdChiYXopOyB9XG4gICAgICAgICAgICAgIGVsc2UgcmV0W2NvdW50XVtqXSA9IGJhejtcbiAgICAgICAgICB9XG4gICAgICAgICAgY291bnQrKztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbn1cblxubnVtZXJpYy50b0NTViA9IGZ1bmN0aW9uIHRvQ1NWKEEpIHtcbiAgICB2YXIgcyA9IG51bWVyaWMuZGltKEEpO1xuICAgIHZhciBpLGosbSxuLHJvdyxyZXQ7XG4gICAgbSA9IHNbMF07XG4gICAgbiA9IHNbMV07XG4gICAgcmV0ID0gW107XG4gICAgZm9yKGk9MDtpPG07aSsrKSB7XG4gICAgICAgIHJvdyA9IFtdO1xuICAgICAgICBmb3Ioaj0wO2o8bTtqKyspIHsgcm93W2pdID0gQVtpXVtqXS50b1N0cmluZygpOyB9XG4gICAgICAgIHJldFtpXSA9IHJvdy5qb2luKCcsICcpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0LmpvaW4oJ1xcbicpKydcXG4nO1xufVxuXG5udW1lcmljLmdldFVSTCA9IGZ1bmN0aW9uIGdldFVSTCh1cmwpIHtcbiAgICB2YXIgY2xpZW50ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgY2xpZW50Lm9wZW4oXCJHRVRcIix1cmwsZmFsc2UpO1xuICAgIGNsaWVudC5zZW5kKCk7XG4gICAgcmV0dXJuIGNsaWVudDtcbn1cblxubnVtZXJpYy5pbWFnZVVSTCA9IGZ1bmN0aW9uIGltYWdlVVJMKGltZykge1xuICAgIGZ1bmN0aW9uIGJhc2U2NChBKSB7XG4gICAgICAgIHZhciBuID0gQS5sZW5ndGgsIGkseCx5LHoscCxxLHIscztcbiAgICAgICAgdmFyIGtleSA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLz1cIjtcbiAgICAgICAgdmFyIHJldCA9IFwiXCI7XG4gICAgICAgIGZvcihpPTA7aTxuO2krPTMpIHtcbiAgICAgICAgICAgIHggPSBBW2ldO1xuICAgICAgICAgICAgeSA9IEFbaSsxXTtcbiAgICAgICAgICAgIHogPSBBW2krMl07XG4gICAgICAgICAgICBwID0geCA+PiAyO1xuICAgICAgICAgICAgcSA9ICgoeCAmIDMpIDw8IDQpICsgKHkgPj4gNCk7XG4gICAgICAgICAgICByID0gKCh5ICYgMTUpIDw8IDIpICsgKHogPj4gNik7XG4gICAgICAgICAgICBzID0geiAmIDYzO1xuICAgICAgICAgICAgaWYoaSsxPj1uKSB7IHIgPSBzID0gNjQ7IH1cbiAgICAgICAgICAgIGVsc2UgaWYoaSsyPj1uKSB7IHMgPSA2NDsgfVxuICAgICAgICAgICAgcmV0ICs9IGtleS5jaGFyQXQocCkgKyBrZXkuY2hhckF0KHEpICsga2V5LmNoYXJBdChyKSArIGtleS5jaGFyQXQocyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGNyYzMyQXJyYXkgKGEsZnJvbSx0bykge1xuICAgICAgICBpZih0eXBlb2YgZnJvbSA9PT0gXCJ1bmRlZmluZWRcIikgeyBmcm9tID0gMDsgfVxuICAgICAgICBpZih0eXBlb2YgdG8gPT09IFwidW5kZWZpbmVkXCIpIHsgdG8gPSBhLmxlbmd0aDsgfVxuICAgICAgICB2YXIgdGFibGUgPSBbMHgwMDAwMDAwMCwgMHg3NzA3MzA5NiwgMHhFRTBFNjEyQywgMHg5OTA5NTFCQSwgMHgwNzZEQzQxOSwgMHg3MDZBRjQ4RiwgMHhFOTYzQTUzNSwgMHg5RTY0OTVBMyxcbiAgICAgICAgICAgICAgICAgICAgIDB4MEVEQjg4MzIsIDB4NzlEQ0I4QTQsIDB4RTBENUU5MUUsIDB4OTdEMkQ5ODgsIDB4MDlCNjRDMkIsIDB4N0VCMTdDQkQsIDB4RTdCODJEMDcsIDB4OTBCRjFEOTEsIFxuICAgICAgICAgICAgICAgICAgICAgMHgxREI3MTA2NCwgMHg2QUIwMjBGMiwgMHhGM0I5NzE0OCwgMHg4NEJFNDFERSwgMHgxQURBRDQ3RCwgMHg2RERERTRFQiwgMHhGNEQ0QjU1MSwgMHg4M0QzODVDNyxcbiAgICAgICAgICAgICAgICAgICAgIDB4MTM2Qzk4NTYsIDB4NjQ2QkE4QzAsIDB4RkQ2MkY5N0EsIDB4OEE2NUM5RUMsIDB4MTQwMTVDNEYsIDB4NjMwNjZDRDksIDB4RkEwRjNENjMsIDB4OEQwODBERjUsIFxuICAgICAgICAgICAgICAgICAgICAgMHgzQjZFMjBDOCwgMHg0QzY5MTA1RSwgMHhENTYwNDFFNCwgMHhBMjY3NzE3MiwgMHgzQzAzRTREMSwgMHg0QjA0RDQ0NywgMHhEMjBEODVGRCwgMHhBNTBBQjU2QiwgXG4gICAgICAgICAgICAgICAgICAgICAweDM1QjVBOEZBLCAweDQyQjI5ODZDLCAweERCQkJDOUQ2LCAweEFDQkNGOTQwLCAweDMyRDg2Q0UzLCAweDQ1REY1Qzc1LCAweERDRDYwRENGLCAweEFCRDEzRDU5LCBcbiAgICAgICAgICAgICAgICAgICAgIDB4MjZEOTMwQUMsIDB4NTFERTAwM0EsIDB4QzhENzUxODAsIDB4QkZEMDYxMTYsIDB4MjFCNEY0QjUsIDB4NTZCM0M0MjMsIDB4Q0ZCQTk1OTksIDB4QjhCREE1MEYsXG4gICAgICAgICAgICAgICAgICAgICAweDI4MDJCODlFLCAweDVGMDU4ODA4LCAweEM2MENEOUIyLCAweEIxMEJFOTI0LCAweDJGNkY3Qzg3LCAweDU4Njg0QzExLCAweEMxNjExREFCLCAweEI2NjYyRDNELFxuICAgICAgICAgICAgICAgICAgICAgMHg3NkRDNDE5MCwgMHgwMURCNzEwNiwgMHg5OEQyMjBCQywgMHhFRkQ1MTAyQSwgMHg3MUIxODU4OSwgMHgwNkI2QjUxRiwgMHg5RkJGRTRBNSwgMHhFOEI4RDQzMyxcbiAgICAgICAgICAgICAgICAgICAgIDB4NzgwN0M5QTIsIDB4MEYwMEY5MzQsIDB4OTYwOUE4OEUsIDB4RTEwRTk4MTgsIDB4N0Y2QTBEQkIsIDB4MDg2RDNEMkQsIDB4OTE2NDZDOTcsIDB4RTY2MzVDMDEsIFxuICAgICAgICAgICAgICAgICAgICAgMHg2QjZCNTFGNCwgMHgxQzZDNjE2MiwgMHg4NTY1MzBEOCwgMHhGMjYyMDA0RSwgMHg2QzA2OTVFRCwgMHgxQjAxQTU3QiwgMHg4MjA4RjRDMSwgMHhGNTBGQzQ1NywgXG4gICAgICAgICAgICAgICAgICAgICAweDY1QjBEOUM2LCAweDEyQjdFOTUwLCAweDhCQkVCOEVBLCAweEZDQjk4ODdDLCAweDYyREQxRERGLCAweDE1REEyRDQ5LCAweDhDRDM3Q0YzLCAweEZCRDQ0QzY1LCBcbiAgICAgICAgICAgICAgICAgICAgIDB4NERCMjYxNTgsIDB4M0FCNTUxQ0UsIDB4QTNCQzAwNzQsIDB4RDRCQjMwRTIsIDB4NEFERkE1NDEsIDB4M0REODk1RDcsIDB4QTREMUM0NkQsIDB4RDNENkY0RkIsIFxuICAgICAgICAgICAgICAgICAgICAgMHg0MzY5RTk2QSwgMHgzNDZFRDlGQywgMHhBRDY3ODg0NiwgMHhEQTYwQjhEMCwgMHg0NDA0MkQ3MywgMHgzMzAzMURFNSwgMHhBQTBBNEM1RiwgMHhERDBEN0NDOSwgXG4gICAgICAgICAgICAgICAgICAgICAweDUwMDU3MTNDLCAweDI3MDI0MUFBLCAweEJFMEIxMDEwLCAweEM5MEMyMDg2LCAweDU3NjhCNTI1LCAweDIwNkY4NUIzLCAweEI5NjZENDA5LCAweENFNjFFNDlGLCBcbiAgICAgICAgICAgICAgICAgICAgIDB4NUVERUY5MEUsIDB4MjlEOUM5OTgsIDB4QjBEMDk4MjIsIDB4QzdEN0E4QjQsIDB4NTlCMzNEMTcsIDB4MkVCNDBEODEsIDB4QjdCRDVDM0IsIDB4QzBCQTZDQUQsIFxuICAgICAgICAgICAgICAgICAgICAgMHhFREI4ODMyMCwgMHg5QUJGQjNCNiwgMHgwM0I2RTIwQywgMHg3NEIxRDI5QSwgMHhFQUQ1NDczOSwgMHg5REQyNzdBRiwgMHgwNERCMjYxNSwgMHg3M0RDMTY4MywgXG4gICAgICAgICAgICAgICAgICAgICAweEUzNjMwQjEyLCAweDk0NjQzQjg0LCAweDBENkQ2QTNFLCAweDdBNkE1QUE4LCAweEU0MEVDRjBCLCAweDkzMDlGRjlELCAweDBBMDBBRTI3LCAweDdEMDc5RUIxLCBcbiAgICAgICAgICAgICAgICAgICAgIDB4RjAwRjkzNDQsIDB4ODcwOEEzRDIsIDB4MUUwMUYyNjgsIDB4NjkwNkMyRkUsIDB4Rjc2MjU3NUQsIDB4ODA2NTY3Q0IsIDB4MTk2QzM2NzEsIDB4NkU2QjA2RTcsIFxuICAgICAgICAgICAgICAgICAgICAgMHhGRUQ0MUI3NiwgMHg4OUQzMkJFMCwgMHgxMERBN0E1QSwgMHg2N0RENEFDQywgMHhGOUI5REY2RiwgMHg4RUJFRUZGOSwgMHgxN0I3QkU0MywgMHg2MEIwOEVENSwgXG4gICAgICAgICAgICAgICAgICAgICAweEQ2RDZBM0U4LCAweEExRDE5MzdFLCAweDM4RDhDMkM0LCAweDRGREZGMjUyLCAweEQxQkI2N0YxLCAweEE2QkM1NzY3LCAweDNGQjUwNkRELCAweDQ4QjIzNjRCLCBcbiAgICAgICAgICAgICAgICAgICAgIDB4RDgwRDJCREEsIDB4QUYwQTFCNEMsIDB4MzYwMzRBRjYsIDB4NDEwNDdBNjAsIDB4REY2MEVGQzMsIDB4QTg2N0RGNTUsIDB4MzE2RThFRUYsIDB4NDY2OUJFNzksIFxuICAgICAgICAgICAgICAgICAgICAgMHhDQjYxQjM4QywgMHhCQzY2ODMxQSwgMHgyNTZGRDJBMCwgMHg1MjY4RTIzNiwgMHhDQzBDNzc5NSwgMHhCQjBCNDcwMywgMHgyMjAyMTZCOSwgMHg1NTA1MjYyRiwgXG4gICAgICAgICAgICAgICAgICAgICAweEM1QkEzQkJFLCAweEIyQkQwQjI4LCAweDJCQjQ1QTkyLCAweDVDQjM2QTA0LCAweEMyRDdGRkE3LCAweEI1RDBDRjMxLCAweDJDRDk5RThCLCAweDVCREVBRTFELCBcbiAgICAgICAgICAgICAgICAgICAgIDB4OUI2NEMyQjAsIDB4RUM2M0YyMjYsIDB4NzU2QUEzOUMsIDB4MDI2RDkzMEEsIDB4OUMwOTA2QTksIDB4RUIwRTM2M0YsIDB4NzIwNzY3ODUsIDB4MDUwMDU3MTMsIFxuICAgICAgICAgICAgICAgICAgICAgMHg5NUJGNEE4MiwgMHhFMkI4N0ExNCwgMHg3QkIxMkJBRSwgMHgwQ0I2MUIzOCwgMHg5MkQyOEU5QiwgMHhFNUQ1QkUwRCwgMHg3Q0RDRUZCNywgMHgwQkRCREYyMSwgXG4gICAgICAgICAgICAgICAgICAgICAweDg2RDNEMkQ0LCAweEYxRDRFMjQyLCAweDY4RERCM0Y4LCAweDFGREE4MzZFLCAweDgxQkUxNkNELCAweEY2QjkyNjVCLCAweDZGQjA3N0UxLCAweDE4Qjc0Nzc3LCBcbiAgICAgICAgICAgICAgICAgICAgIDB4ODgwODVBRTYsIDB4RkYwRjZBNzAsIDB4NjYwNjNCQ0EsIDB4MTEwMTBCNUMsIDB4OEY2NTlFRkYsIDB4Rjg2MkFFNjksIDB4NjE2QkZGRDMsIDB4MTY2Q0NGNDUsIFxuICAgICAgICAgICAgICAgICAgICAgMHhBMDBBRTI3OCwgMHhENzBERDJFRSwgMHg0RTA0ODM1NCwgMHgzOTAzQjNDMiwgMHhBNzY3MjY2MSwgMHhEMDYwMTZGNywgMHg0OTY5NDc0RCwgMHgzRTZFNzdEQiwgXG4gICAgICAgICAgICAgICAgICAgICAweEFFRDE2QTRBLCAweEQ5RDY1QURDLCAweDQwREYwQjY2LCAweDM3RDgzQkYwLCAweEE5QkNBRTUzLCAweERFQkI5RUM1LCAweDQ3QjJDRjdGLCAweDMwQjVGRkU5LCBcbiAgICAgICAgICAgICAgICAgICAgIDB4QkRCREYyMUMsIDB4Q0FCQUMyOEEsIDB4NTNCMzkzMzAsIDB4MjRCNEEzQTYsIDB4QkFEMDM2MDUsIDB4Q0RENzA2OTMsIDB4NTRERTU3MjksIDB4MjNEOTY3QkYsIFxuICAgICAgICAgICAgICAgICAgICAgMHhCMzY2N0EyRSwgMHhDNDYxNEFCOCwgMHg1RDY4MUIwMiwgMHgyQTZGMkI5NCwgMHhCNDBCQkUzNywgMHhDMzBDOEVBMSwgMHg1QTA1REYxQiwgMHgyRDAyRUY4RF07XG4gICAgIFxuICAgICAgICB2YXIgY3JjID0gLTEsIHkgPSAwLCBuID0gYS5sZW5ndGgsaTtcblxuICAgICAgICBmb3IgKGkgPSBmcm9tOyBpIDwgdG87IGkrKykge1xuICAgICAgICAgICAgeSA9IChjcmMgXiBhW2ldKSAmIDB4RkY7XG4gICAgICAgICAgICBjcmMgPSAoY3JjID4+PiA4KSBeIHRhYmxlW3ldO1xuICAgICAgICB9XG4gICAgIFxuICAgICAgICByZXR1cm4gY3JjIF4gKC0xKTtcbiAgICB9XG5cbiAgICB2YXIgaCA9IGltZ1swXS5sZW5ndGgsIHcgPSBpbWdbMF1bMF0ubGVuZ3RoLCBzMSwgczIsIG5leHQsayxsZW5ndGgsYSxiLGksaixhZGxlcjMyLGNyYzMyO1xuICAgIHZhciBzdHJlYW0gPSBbXG4gICAgICAgICAgICAgICAgICAxMzcsIDgwLCA3OCwgNzEsIDEzLCAxMCwgMjYsIDEwLCAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAwOiBQTkcgc2lnbmF0dXJlXG4gICAgICAgICAgICAgICAgICAwLDAsMCwxMywgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICA4OiBJSERSIENodW5rIGxlbmd0aFxuICAgICAgICAgICAgICAgICAgNzMsIDcyLCA2OCwgODIsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAxMjogXCJJSERSXCIgXG4gICAgICAgICAgICAgICAgICAodyA+PiAyNCkgJiAyNTUsICh3ID4+IDE2KSAmIDI1NSwgKHcgPj4gOCkgJiAyNTUsIHcmMjU1LCAgIC8vIDE2OiBXaWR0aFxuICAgICAgICAgICAgICAgICAgKGggPj4gMjQpICYgMjU1LCAoaCA+PiAxNikgJiAyNTUsIChoID4+IDgpICYgMjU1LCBoJjI1NSwgICAvLyAyMDogSGVpZ2h0XG4gICAgICAgICAgICAgICAgICA4LCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIDI0OiBiaXQgZGVwdGhcbiAgICAgICAgICAgICAgICAgIDIsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gMjU6IFJHQlxuICAgICAgICAgICAgICAgICAgMCwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAyNjogZGVmbGF0ZVxuICAgICAgICAgICAgICAgICAgMCwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAyNzogbm8gZmlsdGVyXG4gICAgICAgICAgICAgICAgICAwLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIDI4OiBubyBpbnRlcmxhY2VcbiAgICAgICAgICAgICAgICAgIC0xLC0yLC0zLC00LCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gMjk6IENSQ1xuICAgICAgICAgICAgICAgICAgLTUsLTYsLTcsLTgsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAzMzogSURBVCBDaHVuayBsZW5ndGhcbiAgICAgICAgICAgICAgICAgIDczLCA2OCwgNjUsIDg0LCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gMzc6IFwiSURBVFwiXG4gICAgICAgICAgICAgICAgICAvLyBSRkMgMTk1MCBoZWFkZXIgc3RhcnRzIGhlcmVcbiAgICAgICAgICAgICAgICAgIDgsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gNDE6IFJGQzE5NTAgQ01GXG4gICAgICAgICAgICAgICAgICAyOSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIDQyOiBSRkMxOTUwIEZMR1xuICAgICAgICAgICAgICAgICAgXTtcbiAgICBjcmMzMiA9IGNyYzMyQXJyYXkoc3RyZWFtLDEyLDI5KTtcbiAgICBzdHJlYW1bMjldID0gKGNyYzMyPj4yNCkmMjU1O1xuICAgIHN0cmVhbVszMF0gPSAoY3JjMzI+PjE2KSYyNTU7XG4gICAgc3RyZWFtWzMxXSA9IChjcmMzMj4+OCkmMjU1O1xuICAgIHN0cmVhbVszMl0gPSAoY3JjMzIpJjI1NTtcbiAgICBzMSA9IDE7XG4gICAgczIgPSAwO1xuICAgIGZvcihpPTA7aTxoO2krKykge1xuICAgICAgICBpZihpPGgtMSkgeyBzdHJlYW0ucHVzaCgwKTsgfVxuICAgICAgICBlbHNlIHsgc3RyZWFtLnB1c2goMSk7IH1cbiAgICAgICAgYSA9ICgzKncrMSsoaT09PTApKSYyNTU7IGIgPSAoKDMqdysxKyhpPT09MCkpPj44KSYyNTU7XG4gICAgICAgIHN0cmVhbS5wdXNoKGEpOyBzdHJlYW0ucHVzaChiKTtcbiAgICAgICAgc3RyZWFtLnB1c2goKH5hKSYyNTUpOyBzdHJlYW0ucHVzaCgofmIpJjI1NSk7XG4gICAgICAgIGlmKGk9PT0wKSBzdHJlYW0ucHVzaCgwKTtcbiAgICAgICAgZm9yKGo9MDtqPHc7aisrKSB7XG4gICAgICAgICAgICBmb3Ioaz0wO2s8MztrKyspIHtcbiAgICAgICAgICAgICAgICBhID0gaW1nW2tdW2ldW2pdO1xuICAgICAgICAgICAgICAgIGlmKGE+MjU1KSBhID0gMjU1O1xuICAgICAgICAgICAgICAgIGVsc2UgaWYoYTwwKSBhPTA7XG4gICAgICAgICAgICAgICAgZWxzZSBhID0gTWF0aC5yb3VuZChhKTtcbiAgICAgICAgICAgICAgICBzMSA9IChzMSArIGEgKSU2NTUyMTtcbiAgICAgICAgICAgICAgICBzMiA9IChzMiArIHMxKSU2NTUyMTtcbiAgICAgICAgICAgICAgICBzdHJlYW0ucHVzaChhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdHJlYW0ucHVzaCgwKTtcbiAgICB9XG4gICAgYWRsZXIzMiA9IChzMjw8MTYpK3MxO1xuICAgIHN0cmVhbS5wdXNoKChhZGxlcjMyPj4yNCkmMjU1KTtcbiAgICBzdHJlYW0ucHVzaCgoYWRsZXIzMj4+MTYpJjI1NSk7XG4gICAgc3RyZWFtLnB1c2goKGFkbGVyMzI+PjgpJjI1NSk7XG4gICAgc3RyZWFtLnB1c2goKGFkbGVyMzIpJjI1NSk7XG4gICAgbGVuZ3RoID0gc3RyZWFtLmxlbmd0aCAtIDQxO1xuICAgIHN0cmVhbVszM10gPSAobGVuZ3RoPj4yNCkmMjU1O1xuICAgIHN0cmVhbVszNF0gPSAobGVuZ3RoPj4xNikmMjU1O1xuICAgIHN0cmVhbVszNV0gPSAobGVuZ3RoPj44KSYyNTU7XG4gICAgc3RyZWFtWzM2XSA9IChsZW5ndGgpJjI1NTtcbiAgICBjcmMzMiA9IGNyYzMyQXJyYXkoc3RyZWFtLDM3KTtcbiAgICBzdHJlYW0ucHVzaCgoY3JjMzI+PjI0KSYyNTUpO1xuICAgIHN0cmVhbS5wdXNoKChjcmMzMj4+MTYpJjI1NSk7XG4gICAgc3RyZWFtLnB1c2goKGNyYzMyPj44KSYyNTUpO1xuICAgIHN0cmVhbS5wdXNoKChjcmMzMikmMjU1KTtcbiAgICBzdHJlYW0ucHVzaCgwKTtcbiAgICBzdHJlYW0ucHVzaCgwKTtcbiAgICBzdHJlYW0ucHVzaCgwKTtcbiAgICBzdHJlYW0ucHVzaCgwKTtcbi8vICAgIGEgPSBzdHJlYW0ubGVuZ3RoO1xuICAgIHN0cmVhbS5wdXNoKDczKTsgIC8vIElcbiAgICBzdHJlYW0ucHVzaCg2OSk7ICAvLyBFXG4gICAgc3RyZWFtLnB1c2goNzgpOyAgLy8gTlxuICAgIHN0cmVhbS5wdXNoKDY4KTsgIC8vIERcbiAgICBzdHJlYW0ucHVzaCgxNzQpOyAvLyBDUkMxXG4gICAgc3RyZWFtLnB1c2goNjYpOyAgLy8gQ1JDMlxuICAgIHN0cmVhbS5wdXNoKDk2KTsgIC8vIENSQzNcbiAgICBzdHJlYW0ucHVzaCgxMzApOyAvLyBDUkM0XG4gICAgcmV0dXJuICdkYXRhOmltYWdlL3BuZztiYXNlNjQsJytiYXNlNjQoc3RyZWFtKTtcbn1cblxuLy8gMi4gTGluZWFyIGFsZ2VicmEgd2l0aCBBcnJheXMuXG5udW1lcmljLl9kaW0gPSBmdW5jdGlvbiBfZGltKHgpIHtcbiAgICB2YXIgcmV0ID0gW107XG4gICAgd2hpbGUodHlwZW9mIHggPT09IFwib2JqZWN0XCIpIHsgcmV0LnB1c2goeC5sZW5ndGgpOyB4ID0geFswXTsgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbm51bWVyaWMuZGltID0gZnVuY3Rpb24gZGltKHgpIHtcbiAgICB2YXIgeSx6O1xuICAgIGlmKHR5cGVvZiB4ID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHkgPSB4WzBdO1xuICAgICAgICBpZih0eXBlb2YgeSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICAgICAgeiA9IHlbMF07XG4gICAgICAgICAgICBpZih0eXBlb2YgeiA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBudW1lcmljLl9kaW0oeCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW3gubGVuZ3RoLHkubGVuZ3RoXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW3gubGVuZ3RoXTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xufVxuXG5udW1lcmljLm1hcHJlZHVjZSA9IGZ1bmN0aW9uIG1hcHJlZHVjZShib2R5LGluaXQpIHtcbiAgICByZXR1cm4gRnVuY3Rpb24oJ3gnLCdhY2N1bScsJ19zJywnX2snLFxuICAgICAgICAgICAgJ2lmKHR5cGVvZiBhY2N1bSA9PT0gXCJ1bmRlZmluZWRcIikgYWNjdW0gPSAnK2luaXQrJztcXG4nK1xuICAgICAgICAgICAgJ2lmKHR5cGVvZiB4ID09PSBcIm51bWJlclwiKSB7IHZhciB4aSA9IHg7ICcrYm9keSsnOyByZXR1cm4gYWNjdW07IH1cXG4nK1xuICAgICAgICAgICAgJ2lmKHR5cGVvZiBfcyA9PT0gXCJ1bmRlZmluZWRcIikgX3MgPSBudW1lcmljLmRpbSh4KTtcXG4nK1xuICAgICAgICAgICAgJ2lmKHR5cGVvZiBfayA9PT0gXCJ1bmRlZmluZWRcIikgX2sgPSAwO1xcbicrXG4gICAgICAgICAgICAndmFyIF9uID0gX3NbX2tdO1xcbicrXG4gICAgICAgICAgICAndmFyIGkseGk7XFxuJytcbiAgICAgICAgICAgICdpZihfayA8IF9zLmxlbmd0aC0xKSB7XFxuJytcbiAgICAgICAgICAgICcgICAgZm9yKGk9X24tMTtpPj0wO2ktLSkge1xcbicrXG4gICAgICAgICAgICAnICAgICAgICBhY2N1bSA9IGFyZ3VtZW50cy5jYWxsZWUoeFtpXSxhY2N1bSxfcyxfaysxKTtcXG4nK1xuICAgICAgICAgICAgJyAgICB9JytcbiAgICAgICAgICAgICcgICAgcmV0dXJuIGFjY3VtO1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICAnZm9yKGk9X24tMTtpPj0xO2ktPTIpIHsgXFxuJytcbiAgICAgICAgICAgICcgICAgeGkgPSB4W2ldO1xcbicrXG4gICAgICAgICAgICAnICAgICcrYm9keSsnO1xcbicrXG4gICAgICAgICAgICAnICAgIHhpID0geFtpLTFdO1xcbicrXG4gICAgICAgICAgICAnICAgICcrYm9keSsnO1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICAnaWYoaSA9PT0gMCkge1xcbicrXG4gICAgICAgICAgICAnICAgIHhpID0geFtpXTtcXG4nK1xuICAgICAgICAgICAgJyAgICAnK2JvZHkrJ1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICAncmV0dXJuIGFjY3VtOydcbiAgICAgICAgICAgICk7XG59XG5udW1lcmljLm1hcHJlZHVjZTIgPSBmdW5jdGlvbiBtYXByZWR1Y2UyKGJvZHksc2V0dXApIHtcbiAgICByZXR1cm4gRnVuY3Rpb24oJ3gnLFxuICAgICAgICAgICAgJ3ZhciBuID0geC5sZW5ndGg7XFxuJytcbiAgICAgICAgICAgICd2YXIgaSx4aTtcXG4nK3NldHVwKyc7XFxuJytcbiAgICAgICAgICAgICdmb3IoaT1uLTE7aSE9PS0xOy0taSkgeyBcXG4nK1xuICAgICAgICAgICAgJyAgICB4aSA9IHhbaV07XFxuJytcbiAgICAgICAgICAgICcgICAgJytib2R5Kyc7XFxuJytcbiAgICAgICAgICAgICd9XFxuJytcbiAgICAgICAgICAgICdyZXR1cm4gYWNjdW07J1xuICAgICAgICAgICAgKTtcbn1cblxuXG5udW1lcmljLnNhbWUgPSBmdW5jdGlvbiBzYW1lKHgseSkge1xuICAgIHZhciBpLG47XG4gICAgaWYoISh4IGluc3RhbmNlb2YgQXJyYXkpIHx8ICEoeSBpbnN0YW5jZW9mIEFycmF5KSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICBuID0geC5sZW5ndGg7XG4gICAgaWYobiAhPT0geS5sZW5ndGgpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgZm9yKGk9MDtpPG47aSsrKSB7XG4gICAgICAgIGlmKHhbaV0gPT09IHlbaV0pIHsgY29udGludWU7IH1cbiAgICAgICAgaWYodHlwZW9mIHhbaV0gPT09IFwib2JqZWN0XCIpIHsgaWYoIXNhbWUoeFtpXSx5W2ldKSkgcmV0dXJuIGZhbHNlOyB9XG4gICAgICAgIGVsc2UgeyByZXR1cm4gZmFsc2U7IH1cbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbm51bWVyaWMucmVwID0gZnVuY3Rpb24gcmVwKHMsdixrKSB7XG4gICAgaWYodHlwZW9mIGsgPT09IFwidW5kZWZpbmVkXCIpIHsgaz0wOyB9XG4gICAgdmFyIG4gPSBzW2tdLCByZXQgPSBBcnJheShuKSwgaTtcbiAgICBpZihrID09PSBzLmxlbmd0aC0xKSB7XG4gICAgICAgIGZvcihpPW4tMjtpPj0wO2ktPTIpIHsgcmV0W2krMV0gPSB2OyByZXRbaV0gPSB2OyB9XG4gICAgICAgIGlmKGk9PT0tMSkgeyByZXRbMF0gPSB2OyB9XG4gICAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuICAgIGZvcihpPW4tMTtpPj0wO2ktLSkgeyByZXRbaV0gPSBudW1lcmljLnJlcChzLHYsaysxKTsgfVxuICAgIHJldHVybiByZXQ7XG59XG5cblxubnVtZXJpYy5kb3RNTXNtYWxsID0gZnVuY3Rpb24gZG90TU1zbWFsbCh4LHkpIHtcbiAgICB2YXIgaSxqLGsscCxxLHIscmV0LGZvbyxiYXIsd29vLGkwLGswLHAwLHIwO1xuICAgIHAgPSB4Lmxlbmd0aDsgcSA9IHkubGVuZ3RoOyByID0geVswXS5sZW5ndGg7XG4gICAgcmV0ID0gQXJyYXkocCk7XG4gICAgZm9yKGk9cC0xO2k+PTA7aS0tKSB7XG4gICAgICAgIGZvbyA9IEFycmF5KHIpO1xuICAgICAgICBiYXIgPSB4W2ldO1xuICAgICAgICBmb3Ioaz1yLTE7az49MDtrLS0pIHtcbiAgICAgICAgICAgIHdvbyA9IGJhcltxLTFdKnlbcS0xXVtrXTtcbiAgICAgICAgICAgIGZvcihqPXEtMjtqPj0xO2otPTIpIHtcbiAgICAgICAgICAgICAgICBpMCA9IGotMTtcbiAgICAgICAgICAgICAgICB3b28gKz0gYmFyW2pdKnlbal1ba10gKyBiYXJbaTBdKnlbaTBdW2tdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoaj09PTApIHsgd29vICs9IGJhclswXSp5WzBdW2tdOyB9XG4gICAgICAgICAgICBmb29ba10gPSB3b287XG4gICAgICAgIH1cbiAgICAgICAgcmV0W2ldID0gZm9vO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xufVxubnVtZXJpYy5fZ2V0Q29sID0gZnVuY3Rpb24gX2dldENvbChBLGoseCkge1xuICAgIHZhciBuID0gQS5sZW5ndGgsIGk7XG4gICAgZm9yKGk9bi0xO2k+MDstLWkpIHtcbiAgICAgICAgeFtpXSA9IEFbaV1bal07XG4gICAgICAgIC0taTtcbiAgICAgICAgeFtpXSA9IEFbaV1bal07XG4gICAgfVxuICAgIGlmKGk9PT0wKSB4WzBdID0gQVswXVtqXTtcbn1cbm51bWVyaWMuZG90TU1iaWcgPSBmdW5jdGlvbiBkb3RNTWJpZyh4LHkpe1xuICAgIHZhciBnYyA9IG51bWVyaWMuX2dldENvbCwgcCA9IHkubGVuZ3RoLCB2ID0gQXJyYXkocCk7XG4gICAgdmFyIG0gPSB4Lmxlbmd0aCwgbiA9IHlbMF0ubGVuZ3RoLCBBID0gbmV3IEFycmF5KG0pLCB4ajtcbiAgICB2YXIgVlYgPSBudW1lcmljLmRvdFZWO1xuICAgIHZhciBpLGosayx6O1xuICAgIC0tcDtcbiAgICAtLW07XG4gICAgZm9yKGk9bTtpIT09LTE7LS1pKSBBW2ldID0gQXJyYXkobik7XG4gICAgLS1uO1xuICAgIGZvcihpPW47aSE9PS0xOy0taSkge1xuICAgICAgICBnYyh5LGksdik7XG4gICAgICAgIGZvcihqPW07aiE9PS0xOy0taikge1xuICAgICAgICAgICAgej0wO1xuICAgICAgICAgICAgeGogPSB4W2pdO1xuICAgICAgICAgICAgQVtqXVtpXSA9IFZWKHhqLHYpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBBO1xufVxuXG5udW1lcmljLmRvdE1WID0gZnVuY3Rpb24gZG90TVYoeCx5KSB7XG4gICAgdmFyIHAgPSB4Lmxlbmd0aCwgcSA9IHkubGVuZ3RoLGk7XG4gICAgdmFyIHJldCA9IEFycmF5KHApLCBkb3RWViA9IG51bWVyaWMuZG90VlY7XG4gICAgZm9yKGk9cC0xO2k+PTA7aS0tKSB7IHJldFtpXSA9IGRvdFZWKHhbaV0seSk7IH1cbiAgICByZXR1cm4gcmV0O1xufVxuXG5udW1lcmljLmRvdFZNID0gZnVuY3Rpb24gZG90Vk0oeCx5KSB7XG4gICAgdmFyIGksaixrLHAscSxyLHJldCxmb28sYmFyLHdvbyxpMCxrMCxwMCxyMCxzMSxzMixzMyxiYXosYWNjdW07XG4gICAgcCA9IHgubGVuZ3RoOyBxID0geVswXS5sZW5ndGg7XG4gICAgcmV0ID0gQXJyYXkocSk7XG4gICAgZm9yKGs9cS0xO2s+PTA7ay0tKSB7XG4gICAgICAgIHdvbyA9IHhbcC0xXSp5W3AtMV1ba107XG4gICAgICAgIGZvcihqPXAtMjtqPj0xO2otPTIpIHtcbiAgICAgICAgICAgIGkwID0gai0xO1xuICAgICAgICAgICAgd29vICs9IHhbal0qeVtqXVtrXSArIHhbaTBdKnlbaTBdW2tdO1xuICAgICAgICB9XG4gICAgICAgIGlmKGo9PT0wKSB7IHdvbyArPSB4WzBdKnlbMF1ba107IH1cbiAgICAgICAgcmV0W2tdID0gd29vO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xufVxuXG5udW1lcmljLmRvdFZWID0gZnVuY3Rpb24gZG90VlYoeCx5KSB7XG4gICAgdmFyIGksbj14Lmxlbmd0aCxpMSxyZXQgPSB4W24tMV0qeVtuLTFdO1xuICAgIGZvcihpPW4tMjtpPj0xO2ktPTIpIHtcbiAgICAgICAgaTEgPSBpLTE7XG4gICAgICAgIHJldCArPSB4W2ldKnlbaV0gKyB4W2kxXSp5W2kxXTtcbiAgICB9XG4gICAgaWYoaT09PTApIHsgcmV0ICs9IHhbMF0qeVswXTsgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbm51bWVyaWMuZG90ID0gZnVuY3Rpb24gZG90KHgseSkge1xuICAgIHZhciBkID0gbnVtZXJpYy5kaW07XG4gICAgc3dpdGNoKGQoeCkubGVuZ3RoKjEwMDArZCh5KS5sZW5ndGgpIHtcbiAgICBjYXNlIDIwMDI6XG4gICAgICAgIGlmKHkubGVuZ3RoIDwgMTApIHJldHVybiBudW1lcmljLmRvdE1Nc21hbGwoeCx5KTtcbiAgICAgICAgZWxzZSByZXR1cm4gbnVtZXJpYy5kb3RNTWJpZyh4LHkpO1xuICAgIGNhc2UgMjAwMTogcmV0dXJuIG51bWVyaWMuZG90TVYoeCx5KTtcbiAgICBjYXNlIDEwMDI6IHJldHVybiBudW1lcmljLmRvdFZNKHgseSk7XG4gICAgY2FzZSAxMDAxOiByZXR1cm4gbnVtZXJpYy5kb3RWVih4LHkpO1xuICAgIGNhc2UgMTAwMDogcmV0dXJuIG51bWVyaWMubXVsVlMoeCx5KTtcbiAgICBjYXNlIDE6IHJldHVybiBudW1lcmljLm11bFNWKHgseSk7XG4gICAgY2FzZSAwOiByZXR1cm4geCp5O1xuICAgIGRlZmF1bHQ6IHRocm93IG5ldyBFcnJvcignbnVtZXJpYy5kb3Qgb25seSB3b3JrcyBvbiB2ZWN0b3JzIGFuZCBtYXRyaWNlcycpO1xuICAgIH1cbn1cblxubnVtZXJpYy5kaWFnID0gZnVuY3Rpb24gZGlhZyhkKSB7XG4gICAgdmFyIGksaTEsaixuID0gZC5sZW5ndGgsIEEgPSBBcnJheShuKSwgQWk7XG4gICAgZm9yKGk9bi0xO2k+PTA7aS0tKSB7XG4gICAgICAgIEFpID0gQXJyYXkobik7XG4gICAgICAgIGkxID0gaSsyO1xuICAgICAgICBmb3Ioaj1uLTE7aj49aTE7ai09Mikge1xuICAgICAgICAgICAgQWlbal0gPSAwO1xuICAgICAgICAgICAgQWlbai0xXSA9IDA7XG4gICAgICAgIH1cbiAgICAgICAgaWYoaj5pKSB7IEFpW2pdID0gMDsgfVxuICAgICAgICBBaVtpXSA9IGRbaV07XG4gICAgICAgIGZvcihqPWktMTtqPj0xO2otPTIpIHtcbiAgICAgICAgICAgIEFpW2pdID0gMDtcbiAgICAgICAgICAgIEFpW2otMV0gPSAwO1xuICAgICAgICB9XG4gICAgICAgIGlmKGo9PT0wKSB7IEFpWzBdID0gMDsgfVxuICAgICAgICBBW2ldID0gQWk7XG4gICAgfVxuICAgIHJldHVybiBBO1xufVxubnVtZXJpYy5nZXREaWFnID0gZnVuY3Rpb24oQSkge1xuICAgIHZhciBuID0gTWF0aC5taW4oQS5sZW5ndGgsQVswXS5sZW5ndGgpLGkscmV0ID0gQXJyYXkobik7XG4gICAgZm9yKGk9bi0xO2k+PTE7LS1pKSB7XG4gICAgICAgIHJldFtpXSA9IEFbaV1baV07XG4gICAgICAgIC0taTtcbiAgICAgICAgcmV0W2ldID0gQVtpXVtpXTtcbiAgICB9XG4gICAgaWYoaT09PTApIHtcbiAgICAgICAgcmV0WzBdID0gQVswXVswXTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbn1cblxubnVtZXJpYy5pZGVudGl0eSA9IGZ1bmN0aW9uIGlkZW50aXR5KG4pIHsgcmV0dXJuIG51bWVyaWMuZGlhZyhudW1lcmljLnJlcChbbl0sMSkpOyB9XG5udW1lcmljLnBvaW50d2lzZSA9IGZ1bmN0aW9uIHBvaW50d2lzZShwYXJhbXMsYm9keSxzZXR1cCkge1xuICAgIGlmKHR5cGVvZiBzZXR1cCA9PT0gXCJ1bmRlZmluZWRcIikgeyBzZXR1cCA9IFwiXCI7IH1cbiAgICB2YXIgZnVuID0gW107XG4gICAgdmFyIGs7XG4gICAgdmFyIGF2ZWMgPSAvXFxbaVxcXSQvLHAsdGhldmVjID0gJyc7XG4gICAgdmFyIGhhdmVyZXQgPSBmYWxzZTtcbiAgICBmb3Ioaz0wO2s8cGFyYW1zLmxlbmd0aDtrKyspIHtcbiAgICAgICAgaWYoYXZlYy50ZXN0KHBhcmFtc1trXSkpIHtcbiAgICAgICAgICAgIHAgPSBwYXJhbXNba10uc3Vic3RyaW5nKDAscGFyYW1zW2tdLmxlbmd0aC0zKTtcbiAgICAgICAgICAgIHRoZXZlYyA9IHA7XG4gICAgICAgIH0gZWxzZSB7IHAgPSBwYXJhbXNba107IH1cbiAgICAgICAgaWYocD09PSdyZXQnKSBoYXZlcmV0ID0gdHJ1ZTtcbiAgICAgICAgZnVuLnB1c2gocCk7XG4gICAgfVxuICAgIGZ1bltwYXJhbXMubGVuZ3RoXSA9ICdfcyc7XG4gICAgZnVuW3BhcmFtcy5sZW5ndGgrMV0gPSAnX2snO1xuICAgIGZ1bltwYXJhbXMubGVuZ3RoKzJdID0gKFxuICAgICAgICAgICAgJ2lmKHR5cGVvZiBfcyA9PT0gXCJ1bmRlZmluZWRcIikgX3MgPSBudW1lcmljLmRpbSgnK3RoZXZlYysnKTtcXG4nK1xuICAgICAgICAgICAgJ2lmKHR5cGVvZiBfayA9PT0gXCJ1bmRlZmluZWRcIikgX2sgPSAwO1xcbicrXG4gICAgICAgICAgICAndmFyIF9uID0gX3NbX2tdO1xcbicrXG4gICAgICAgICAgICAndmFyIGknKyhoYXZlcmV0PycnOicsIHJldCA9IEFycmF5KF9uKScpKyc7XFxuJytcbiAgICAgICAgICAgICdpZihfayA8IF9zLmxlbmd0aC0xKSB7XFxuJytcbiAgICAgICAgICAgICcgICAgZm9yKGk9X24tMTtpPj0wO2ktLSkgcmV0W2ldID0gYXJndW1lbnRzLmNhbGxlZSgnK3BhcmFtcy5qb2luKCcsJykrJyxfcyxfaysxKTtcXG4nK1xuICAgICAgICAgICAgJyAgICByZXR1cm4gcmV0O1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICBzZXR1cCsnXFxuJytcbiAgICAgICAgICAgICdmb3IoaT1fbi0xO2khPT0tMTstLWkpIHtcXG4nK1xuICAgICAgICAgICAgJyAgICAnK2JvZHkrJ1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICAncmV0dXJuIHJldDsnXG4gICAgICAgICAgICApO1xuICAgIHJldHVybiBGdW5jdGlvbi5hcHBseShudWxsLGZ1bik7XG59XG5udW1lcmljLnBvaW50d2lzZTIgPSBmdW5jdGlvbiBwb2ludHdpc2UyKHBhcmFtcyxib2R5LHNldHVwKSB7XG4gICAgaWYodHlwZW9mIHNldHVwID09PSBcInVuZGVmaW5lZFwiKSB7IHNldHVwID0gXCJcIjsgfVxuICAgIHZhciBmdW4gPSBbXTtcbiAgICB2YXIgaztcbiAgICB2YXIgYXZlYyA9IC9cXFtpXFxdJC8scCx0aGV2ZWMgPSAnJztcbiAgICB2YXIgaGF2ZXJldCA9IGZhbHNlO1xuICAgIGZvcihrPTA7azxwYXJhbXMubGVuZ3RoO2srKykge1xuICAgICAgICBpZihhdmVjLnRlc3QocGFyYW1zW2tdKSkge1xuICAgICAgICAgICAgcCA9IHBhcmFtc1trXS5zdWJzdHJpbmcoMCxwYXJhbXNba10ubGVuZ3RoLTMpO1xuICAgICAgICAgICAgdGhldmVjID0gcDtcbiAgICAgICAgfSBlbHNlIHsgcCA9IHBhcmFtc1trXTsgfVxuICAgICAgICBpZihwPT09J3JldCcpIGhhdmVyZXQgPSB0cnVlO1xuICAgICAgICBmdW4ucHVzaChwKTtcbiAgICB9XG4gICAgZnVuW3BhcmFtcy5sZW5ndGhdID0gKFxuICAgICAgICAgICAgJ3ZhciBfbiA9ICcrdGhldmVjKycubGVuZ3RoO1xcbicrXG4gICAgICAgICAgICAndmFyIGknKyhoYXZlcmV0PycnOicsIHJldCA9IEFycmF5KF9uKScpKyc7XFxuJytcbiAgICAgICAgICAgIHNldHVwKydcXG4nK1xuICAgICAgICAgICAgJ2ZvcihpPV9uLTE7aSE9PS0xOy0taSkge1xcbicrXG4gICAgICAgICAgICBib2R5KydcXG4nK1xuICAgICAgICAgICAgJ31cXG4nK1xuICAgICAgICAgICAgJ3JldHVybiByZXQ7J1xuICAgICAgICAgICAgKTtcbiAgICByZXR1cm4gRnVuY3Rpb24uYXBwbHkobnVsbCxmdW4pO1xufVxubnVtZXJpYy5fYmlmb3JlYWNoID0gKGZ1bmN0aW9uIF9iaWZvcmVhY2goeCx5LHMsayxmKSB7XG4gICAgaWYoayA9PT0gcy5sZW5ndGgtMSkgeyBmKHgseSk7IHJldHVybjsgfVxuICAgIHZhciBpLG49c1trXTtcbiAgICBmb3IoaT1uLTE7aT49MDtpLS0pIHsgX2JpZm9yZWFjaCh0eXBlb2YgeD09PVwib2JqZWN0XCI/eFtpXTp4LHR5cGVvZiB5PT09XCJvYmplY3RcIj95W2ldOnkscyxrKzEsZik7IH1cbn0pO1xubnVtZXJpYy5fYmlmb3JlYWNoMiA9IChmdW5jdGlvbiBfYmlmb3JlYWNoMih4LHkscyxrLGYpIHtcbiAgICBpZihrID09PSBzLmxlbmd0aC0xKSB7IHJldHVybiBmKHgseSk7IH1cbiAgICB2YXIgaSxuPXNba10scmV0ID0gQXJyYXkobik7XG4gICAgZm9yKGk9bi0xO2k+PTA7LS1pKSB7IHJldFtpXSA9IF9iaWZvcmVhY2gyKHR5cGVvZiB4PT09XCJvYmplY3RcIj94W2ldOngsdHlwZW9mIHk9PT1cIm9iamVjdFwiP3lbaV06eSxzLGsrMSxmKTsgfVxuICAgIHJldHVybiByZXQ7XG59KTtcbm51bWVyaWMuX2ZvcmVhY2ggPSAoZnVuY3Rpb24gX2ZvcmVhY2goeCxzLGssZikge1xuICAgIGlmKGsgPT09IHMubGVuZ3RoLTEpIHsgZih4KTsgcmV0dXJuOyB9XG4gICAgdmFyIGksbj1zW2tdO1xuICAgIGZvcihpPW4tMTtpPj0wO2ktLSkgeyBfZm9yZWFjaCh4W2ldLHMsaysxLGYpOyB9XG59KTtcbm51bWVyaWMuX2ZvcmVhY2gyID0gKGZ1bmN0aW9uIF9mb3JlYWNoMih4LHMsayxmKSB7XG4gICAgaWYoayA9PT0gcy5sZW5ndGgtMSkgeyByZXR1cm4gZih4KTsgfVxuICAgIHZhciBpLG49c1trXSwgcmV0ID0gQXJyYXkobik7XG4gICAgZm9yKGk9bi0xO2k+PTA7aS0tKSB7IHJldFtpXSA9IF9mb3JlYWNoMih4W2ldLHMsaysxLGYpOyB9XG4gICAgcmV0dXJuIHJldDtcbn0pO1xuXG4vKm51bWVyaWMuYW55ViA9IG51bWVyaWMubWFwcmVkdWNlKCdpZih4aSkgcmV0dXJuIHRydWU7JywnZmFsc2UnKTtcbm51bWVyaWMuYWxsViA9IG51bWVyaWMubWFwcmVkdWNlKCdpZigheGkpIHJldHVybiBmYWxzZTsnLCd0cnVlJyk7XG5udW1lcmljLmFueSA9IGZ1bmN0aW9uKHgpIHsgaWYodHlwZW9mIHgubGVuZ3RoID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4geDsgcmV0dXJuIG51bWVyaWMuYW55Vih4KTsgfVxubnVtZXJpYy5hbGwgPSBmdW5jdGlvbih4KSB7IGlmKHR5cGVvZiB4Lmxlbmd0aCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIHg7IHJldHVybiBudW1lcmljLmFsbFYoeCk7IH0qL1xuXG5udW1lcmljLm9wczIgPSB7XG4gICAgICAgIGFkZDogJysnLFxuICAgICAgICBzdWI6ICctJyxcbiAgICAgICAgbXVsOiAnKicsXG4gICAgICAgIGRpdjogJy8nLFxuICAgICAgICBtb2Q6ICclJyxcbiAgICAgICAgYW5kOiAnJiYnLFxuICAgICAgICBvcjogICd8fCcsXG4gICAgICAgIGVxOiAgJz09PScsXG4gICAgICAgIG5lcTogJyE9PScsXG4gICAgICAgIGx0OiAgJzwnLFxuICAgICAgICBndDogICc+JyxcbiAgICAgICAgbGVxOiAnPD0nLFxuICAgICAgICBnZXE6ICc+PScsXG4gICAgICAgIGJhbmQ6ICcmJyxcbiAgICAgICAgYm9yOiAnfCcsXG4gICAgICAgIGJ4b3I6ICdeJyxcbiAgICAgICAgbHNoaWZ0OiAnPDwnLFxuICAgICAgICByc2hpZnQ6ICc+PicsXG4gICAgICAgIHJyc2hpZnQ6ICc+Pj4nXG59O1xubnVtZXJpYy5vcHNlcSA9IHtcbiAgICAgICAgYWRkZXE6ICcrPScsXG4gICAgICAgIHN1YmVxOiAnLT0nLFxuICAgICAgICBtdWxlcTogJyo9JyxcbiAgICAgICAgZGl2ZXE6ICcvPScsXG4gICAgICAgIG1vZGVxOiAnJT0nLFxuICAgICAgICBsc2hpZnRlcTogJzw8PScsXG4gICAgICAgIHJzaGlmdGVxOiAnPj49JyxcbiAgICAgICAgcnJzaGlmdGVxOiAnPj4+PScsXG4gICAgICAgIGJhbmRlcTogJyY9JyxcbiAgICAgICAgYm9yZXE6ICd8PScsXG4gICAgICAgIGJ4b3JlcTogJ149J1xufTtcbm51bWVyaWMubWF0aGZ1bnMgPSBbJ2FicycsJ2Fjb3MnLCdhc2luJywnYXRhbicsJ2NlaWwnLCdjb3MnLFxuICAgICAgICAgICAgICAgICAgICAnZXhwJywnZmxvb3InLCdsb2cnLCdyb3VuZCcsJ3NpbicsJ3NxcnQnLCd0YW4nLFxuICAgICAgICAgICAgICAgICAgICAnaXNOYU4nLCdpc0Zpbml0ZSddO1xubnVtZXJpYy5tYXRoZnVuczIgPSBbJ2F0YW4yJywncG93JywnbWF4JywnbWluJ107XG5udW1lcmljLm9wczEgPSB7XG4gICAgICAgIG5lZzogJy0nLFxuICAgICAgICBub3Q6ICchJyxcbiAgICAgICAgYm5vdDogJ34nLFxuICAgICAgICBjbG9uZTogJydcbn07XG5udW1lcmljLm1hcHJlZHVjZXJzID0ge1xuICAgICAgICBhbnk6IFsnaWYoeGkpIHJldHVybiB0cnVlOycsJ3ZhciBhY2N1bSA9IGZhbHNlOyddLFxuICAgICAgICBhbGw6IFsnaWYoIXhpKSByZXR1cm4gZmFsc2U7JywndmFyIGFjY3VtID0gdHJ1ZTsnXSxcbiAgICAgICAgc3VtOiBbJ2FjY3VtICs9IHhpOycsJ3ZhciBhY2N1bSA9IDA7J10sXG4gICAgICAgIHByb2Q6IFsnYWNjdW0gKj0geGk7JywndmFyIGFjY3VtID0gMTsnXSxcbiAgICAgICAgbm9ybTJTcXVhcmVkOiBbJ2FjY3VtICs9IHhpKnhpOycsJ3ZhciBhY2N1bSA9IDA7J10sXG4gICAgICAgIG5vcm1pbmY6IFsnYWNjdW0gPSBtYXgoYWNjdW0sYWJzKHhpKSk7JywndmFyIGFjY3VtID0gMCwgbWF4ID0gTWF0aC5tYXgsIGFicyA9IE1hdGguYWJzOyddLFxuICAgICAgICBub3JtMTogWydhY2N1bSArPSBhYnMoeGkpJywndmFyIGFjY3VtID0gMCwgYWJzID0gTWF0aC5hYnM7J10sXG4gICAgICAgIHN1cDogWydhY2N1bSA9IG1heChhY2N1bSx4aSk7JywndmFyIGFjY3VtID0gLUluZmluaXR5LCBtYXggPSBNYXRoLm1heDsnXSxcbiAgICAgICAgaW5mOiBbJ2FjY3VtID0gbWluKGFjY3VtLHhpKTsnLCd2YXIgYWNjdW0gPSBJbmZpbml0eSwgbWluID0gTWF0aC5taW47J11cbn07XG5cbihmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGksbztcbiAgICBmb3IoaT0wO2k8bnVtZXJpYy5tYXRoZnVuczIubGVuZ3RoOysraSkge1xuICAgICAgICBvID0gbnVtZXJpYy5tYXRoZnVuczJbaV07XG4gICAgICAgIG51bWVyaWMub3BzMltvXSA9IG87XG4gICAgfVxuICAgIGZvcihpIGluIG51bWVyaWMub3BzMikge1xuICAgICAgICBpZihudW1lcmljLm9wczIuaGFzT3duUHJvcGVydHkoaSkpIHtcbiAgICAgICAgICAgIG8gPSBudW1lcmljLm9wczJbaV07XG4gICAgICAgICAgICB2YXIgY29kZSwgY29kZWVxLCBzZXR1cCA9ICcnO1xuICAgICAgICAgICAgaWYobnVtZXJpYy5teUluZGV4T2YuY2FsbChudW1lcmljLm1hdGhmdW5zMixpKSE9PS0xKSB7XG4gICAgICAgICAgICAgICAgc2V0dXAgPSAndmFyICcrbysnID0gTWF0aC4nK28rJztcXG4nO1xuICAgICAgICAgICAgICAgIGNvZGUgPSBmdW5jdGlvbihyLHgseSkgeyByZXR1cm4gcisnID0gJytvKycoJyt4KycsJyt5KycpJzsgfTtcbiAgICAgICAgICAgICAgICBjb2RlZXEgPSBmdW5jdGlvbih4LHkpIHsgcmV0dXJuIHgrJyA9ICcrbysnKCcreCsnLCcreSsnKSc7IH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvZGUgPSBmdW5jdGlvbihyLHgseSkgeyByZXR1cm4gcisnID0gJyt4KycgJytvKycgJyt5OyB9O1xuICAgICAgICAgICAgICAgIGlmKG51bWVyaWMub3BzZXEuaGFzT3duUHJvcGVydHkoaSsnZXEnKSkge1xuICAgICAgICAgICAgICAgICAgICBjb2RlZXEgPSBmdW5jdGlvbih4LHkpIHsgcmV0dXJuIHgrJyAnK28rJz0gJyt5OyB9O1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNvZGVlcSA9IGZ1bmN0aW9uKHgseSkgeyByZXR1cm4geCsnID0gJyt4KycgJytvKycgJyt5OyB9OyAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbnVtZXJpY1tpKydWViddID0gbnVtZXJpYy5wb2ludHdpc2UyKFsneFtpXScsJ3lbaV0nXSxjb2RlKCdyZXRbaV0nLCd4W2ldJywneVtpXScpLHNldHVwKTtcbiAgICAgICAgICAgIG51bWVyaWNbaSsnU1YnXSA9IG51bWVyaWMucG9pbnR3aXNlMihbJ3gnLCd5W2ldJ10sY29kZSgncmV0W2ldJywneCcsJ3lbaV0nKSxzZXR1cCk7XG4gICAgICAgICAgICBudW1lcmljW2krJ1ZTJ10gPSBudW1lcmljLnBvaW50d2lzZTIoWyd4W2ldJywneSddLGNvZGUoJ3JldFtpXScsJ3hbaV0nLCd5Jyksc2V0dXApO1xuICAgICAgICAgICAgbnVtZXJpY1tpXSA9IEZ1bmN0aW9uKFxuICAgICAgICAgICAgICAgICAgICAndmFyIG4gPSBhcmd1bWVudHMubGVuZ3RoLCBpLCB4ID0gYXJndW1lbnRzWzBdLCB5O1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgVlYgPSBudW1lcmljLicraSsnVlYsIFZTID0gbnVtZXJpYy4nK2krJ1ZTLCBTViA9IG51bWVyaWMuJytpKydTVjtcXG4nK1xuICAgICAgICAgICAgICAgICAgICAndmFyIGRpbSA9IG51bWVyaWMuZGltO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICdmb3IoaT0xO2khPT1uOysraSkgeyBcXG4nK1xuICAgICAgICAgICAgICAgICAgICAnICB5ID0gYXJndW1lbnRzW2ldO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICcgIGlmKHR5cGVvZiB4ID09PSBcIm9iamVjdFwiKSB7XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJyAgICAgIGlmKHR5cGVvZiB5ID09PSBcIm9iamVjdFwiKSB4ID0gbnVtZXJpYy5fYmlmb3JlYWNoMih4LHksZGltKHgpLDAsVlYpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICcgICAgICBlbHNlIHggPSBudW1lcmljLl9iaWZvcmVhY2gyKHgseSxkaW0oeCksMCxWUyk7XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJyAgfSBlbHNlIGlmKHR5cGVvZiB5ID09PSBcIm9iamVjdFwiKSB4ID0gbnVtZXJpYy5fYmlmb3JlYWNoMih4LHksZGltKHkpLDAsU1YpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICcgIGVsc2UgJytjb2RlZXEoJ3gnLCd5JykrJ1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd9XFxucmV0dXJuIHg7XFxuJyk7XG4gICAgICAgICAgICBudW1lcmljW29dID0gbnVtZXJpY1tpXTtcbiAgICAgICAgICAgIG51bWVyaWNbaSsnZXFWJ10gPSBudW1lcmljLnBvaW50d2lzZTIoWydyZXRbaV0nLCd4W2ldJ10sIGNvZGVlcSgncmV0W2ldJywneFtpXScpLHNldHVwKTtcbiAgICAgICAgICAgIG51bWVyaWNbaSsnZXFTJ10gPSBudW1lcmljLnBvaW50d2lzZTIoWydyZXRbaV0nLCd4J10sIGNvZGVlcSgncmV0W2ldJywneCcpLHNldHVwKTtcbiAgICAgICAgICAgIG51bWVyaWNbaSsnZXEnXSA9IEZ1bmN0aW9uKFxuICAgICAgICAgICAgICAgICAgICAndmFyIG4gPSBhcmd1bWVudHMubGVuZ3RoLCBpLCB4ID0gYXJndW1lbnRzWzBdLCB5O1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgViA9IG51bWVyaWMuJytpKydlcVYsIFMgPSBudW1lcmljLicraSsnZXFTXFxuJytcbiAgICAgICAgICAgICAgICAgICAgJ3ZhciBzID0gbnVtZXJpYy5kaW0oeCk7XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJ2ZvcihpPTE7aSE9PW47KytpKSB7IFxcbicrXG4gICAgICAgICAgICAgICAgICAgICcgIHkgPSBhcmd1bWVudHNbaV07XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJyAgaWYodHlwZW9mIHkgPT09IFwib2JqZWN0XCIpIG51bWVyaWMuX2JpZm9yZWFjaCh4LHkscywwLFYpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICcgIGVsc2UgbnVtZXJpYy5fYmlmb3JlYWNoKHgseSxzLDAsUyk7XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJ31cXG5yZXR1cm4geDtcXG4nKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBmb3IoaT0wO2k8bnVtZXJpYy5tYXRoZnVuczIubGVuZ3RoOysraSkge1xuICAgICAgICBvID0gbnVtZXJpYy5tYXRoZnVuczJbaV07XG4gICAgICAgIGRlbGV0ZSBudW1lcmljLm9wczJbb107XG4gICAgfVxuICAgIGZvcihpPTA7aTxudW1lcmljLm1hdGhmdW5zLmxlbmd0aDsrK2kpIHtcbiAgICAgICAgbyA9IG51bWVyaWMubWF0aGZ1bnNbaV07XG4gICAgICAgIG51bWVyaWMub3BzMVtvXSA9IG87XG4gICAgfVxuICAgIGZvcihpIGluIG51bWVyaWMub3BzMSkge1xuICAgICAgICBpZihudW1lcmljLm9wczEuaGFzT3duUHJvcGVydHkoaSkpIHtcbiAgICAgICAgICAgIHNldHVwID0gJyc7XG4gICAgICAgICAgICBvID0gbnVtZXJpYy5vcHMxW2ldO1xuICAgICAgICAgICAgaWYobnVtZXJpYy5teUluZGV4T2YuY2FsbChudW1lcmljLm1hdGhmdW5zLGkpIT09LTEpIHtcbiAgICAgICAgICAgICAgICBpZihNYXRoLmhhc093blByb3BlcnR5KG8pKSBzZXR1cCA9ICd2YXIgJytvKycgPSBNYXRoLicrbysnO1xcbic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBudW1lcmljW2krJ2VxViddID0gbnVtZXJpYy5wb2ludHdpc2UyKFsncmV0W2ldJ10sJ3JldFtpXSA9ICcrbysnKHJldFtpXSk7JyxzZXR1cCk7XG4gICAgICAgICAgICBudW1lcmljW2krJ2VxJ10gPSBGdW5jdGlvbigneCcsXG4gICAgICAgICAgICAgICAgICAgICdpZih0eXBlb2YgeCAhPT0gXCJvYmplY3RcIikgcmV0dXJuICcrbysneFxcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgaTtcXG4nK1xuICAgICAgICAgICAgICAgICAgICAndmFyIFYgPSBudW1lcmljLicraSsnZXFWO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgcyA9IG51bWVyaWMuZGltKHgpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICdudW1lcmljLl9mb3JlYWNoKHgscywwLFYpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICdyZXR1cm4geDtcXG4nKTtcbiAgICAgICAgICAgIG51bWVyaWNbaSsnViddID0gbnVtZXJpYy5wb2ludHdpc2UyKFsneFtpXSddLCdyZXRbaV0gPSAnK28rJyh4W2ldKTsnLHNldHVwKTtcbiAgICAgICAgICAgIG51bWVyaWNbaV0gPSBGdW5jdGlvbigneCcsXG4gICAgICAgICAgICAgICAgICAgICdpZih0eXBlb2YgeCAhPT0gXCJvYmplY3RcIikgcmV0dXJuICcrbysnKHgpXFxuJytcbiAgICAgICAgICAgICAgICAgICAgJ3ZhciBpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgViA9IG51bWVyaWMuJytpKydWO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgcyA9IG51bWVyaWMuZGltKHgpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICdyZXR1cm4gbnVtZXJpYy5fZm9yZWFjaDIoeCxzLDAsVik7XFxuJyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZm9yKGk9MDtpPG51bWVyaWMubWF0aGZ1bnMubGVuZ3RoOysraSkge1xuICAgICAgICBvID0gbnVtZXJpYy5tYXRoZnVuc1tpXTtcbiAgICAgICAgZGVsZXRlIG51bWVyaWMub3BzMVtvXTtcbiAgICB9XG4gICAgZm9yKGkgaW4gbnVtZXJpYy5tYXByZWR1Y2Vycykge1xuICAgICAgICBpZihudW1lcmljLm1hcHJlZHVjZXJzLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgICAgICBvID0gbnVtZXJpYy5tYXByZWR1Y2Vyc1tpXTtcbiAgICAgICAgICAgIG51bWVyaWNbaSsnViddID0gbnVtZXJpYy5tYXByZWR1Y2UyKG9bMF0sb1sxXSk7XG4gICAgICAgICAgICBudW1lcmljW2ldID0gRnVuY3Rpb24oJ3gnLCdzJywnaycsXG4gICAgICAgICAgICAgICAgICAgIG9bMV0rXG4gICAgICAgICAgICAgICAgICAgICdpZih0eXBlb2YgeCAhPT0gXCJvYmplY3RcIikgeycrXG4gICAgICAgICAgICAgICAgICAgICcgICAgeGkgPSB4O1xcbicrXG4gICAgICAgICAgICAgICAgICAgIG9bMF0rJztcXG4nK1xuICAgICAgICAgICAgICAgICAgICAnICAgIHJldHVybiBhY2N1bTtcXG4nK1xuICAgICAgICAgICAgICAgICAgICAnfScrXG4gICAgICAgICAgICAgICAgICAgICdpZih0eXBlb2YgcyA9PT0gXCJ1bmRlZmluZWRcIikgcyA9IG51bWVyaWMuZGltKHgpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICdpZih0eXBlb2YgayA9PT0gXCJ1bmRlZmluZWRcIikgayA9IDA7XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJ2lmKGsgPT09IHMubGVuZ3RoLTEpIHJldHVybiBudW1lcmljLicraSsnVih4KTtcXG4nK1xuICAgICAgICAgICAgICAgICAgICAndmFyIHhpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd2YXIgbiA9IHgubGVuZ3RoLCBpO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICdmb3IoaT1uLTE7aSE9PS0xOy0taSkge1xcbicrXG4gICAgICAgICAgICAgICAgICAgICcgICB4aSA9IGFyZ3VtZW50cy5jYWxsZWUoeFtpXSk7XFxuJytcbiAgICAgICAgICAgICAgICAgICAgb1swXSsnO1xcbicrXG4gICAgICAgICAgICAgICAgICAgICd9XFxuJytcbiAgICAgICAgICAgICAgICAgICAgJ3JldHVybiBhY2N1bTtcXG4nKTtcbiAgICAgICAgfVxuICAgIH1cbn0oKSk7XG5cbm51bWVyaWMudHJ1bmNWViA9IG51bWVyaWMucG9pbnR3aXNlKFsneFtpXScsJ3lbaV0nXSwncmV0W2ldID0gcm91bmQoeFtpXS95W2ldKSp5W2ldOycsJ3ZhciByb3VuZCA9IE1hdGgucm91bmQ7Jyk7XG5udW1lcmljLnRydW5jVlMgPSBudW1lcmljLnBvaW50d2lzZShbJ3hbaV0nLCd5J10sJ3JldFtpXSA9IHJvdW5kKHhbaV0veSkqeTsnLCd2YXIgcm91bmQgPSBNYXRoLnJvdW5kOycpO1xubnVtZXJpYy50cnVuY1NWID0gbnVtZXJpYy5wb2ludHdpc2UoWyd4JywneVtpXSddLCdyZXRbaV0gPSByb3VuZCh4L3lbaV0pKnlbaV07JywndmFyIHJvdW5kID0gTWF0aC5yb3VuZDsnKTtcbm51bWVyaWMudHJ1bmMgPSBmdW5jdGlvbiB0cnVuYyh4LHkpIHtcbiAgICBpZih0eXBlb2YgeCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBpZih0eXBlb2YgeSA9PT0gXCJvYmplY3RcIikgcmV0dXJuIG51bWVyaWMudHJ1bmNWVih4LHkpO1xuICAgICAgICByZXR1cm4gbnVtZXJpYy50cnVuY1ZTKHgseSk7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgeSA9PT0gXCJvYmplY3RcIikgcmV0dXJuIG51bWVyaWMudHJ1bmNTVih4LHkpO1xuICAgIHJldHVybiBNYXRoLnJvdW5kKHgveSkqeTtcbn1cblxubnVtZXJpYy5pbnYgPSBmdW5jdGlvbiBpbnYoeCkge1xuICAgIHZhciBzID0gbnVtZXJpYy5kaW0oeCksIGFicyA9IE1hdGguYWJzLCBtID0gc1swXSwgbiA9IHNbMV07XG4gICAgdmFyIEEgPSBudW1lcmljLmNsb25lKHgpLCBBaSwgQWo7XG4gICAgdmFyIEkgPSBudW1lcmljLmlkZW50aXR5KG0pLCBJaSwgSWo7XG4gICAgdmFyIGksaixrLHg7XG4gICAgZm9yKGo9MDtqPG47KytqKSB7XG4gICAgICAgIHZhciBpMCA9IC0xO1xuICAgICAgICB2YXIgdjAgPSAtMTtcbiAgICAgICAgZm9yKGk9ajtpIT09bTsrK2kpIHsgayA9IGFicyhBW2ldW2pdKTsgaWYoaz52MCkgeyBpMCA9IGk7IHYwID0gazsgfSB9XG4gICAgICAgIEFqID0gQVtpMF07IEFbaTBdID0gQVtqXTsgQVtqXSA9IEFqO1xuICAgICAgICBJaiA9IElbaTBdOyBJW2kwXSA9IElbal07IElbal0gPSBJajtcbiAgICAgICAgeCA9IEFqW2pdO1xuICAgICAgICBmb3Ioaz1qO2shPT1uOysraykgICAgQWpba10gLz0geDsgXG4gICAgICAgIGZvcihrPW4tMTtrIT09LTE7LS1rKSBJaltrXSAvPSB4O1xuICAgICAgICBmb3IoaT1tLTE7aSE9PS0xOy0taSkge1xuICAgICAgICAgICAgaWYoaSE9PWopIHtcbiAgICAgICAgICAgICAgICBBaSA9IEFbaV07XG4gICAgICAgICAgICAgICAgSWkgPSBJW2ldO1xuICAgICAgICAgICAgICAgIHggPSBBaVtqXTtcbiAgICAgICAgICAgICAgICBmb3Ioaz1qKzE7ayE9PW47KytrKSAgQWlba10gLT0gQWpba10qeDtcbiAgICAgICAgICAgICAgICBmb3Ioaz1uLTE7az4wOy0taykgeyBJaVtrXSAtPSBJaltrXSp4OyAtLWs7IElpW2tdIC09IElqW2tdKng7IH1cbiAgICAgICAgICAgICAgICBpZihrPT09MCkgSWlbMF0gLT0gSWpbMF0qeDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gSTtcbn1cblxubnVtZXJpYy5kZXQgPSBmdW5jdGlvbiBkZXQoeCkge1xuICAgIHZhciBzID0gbnVtZXJpYy5kaW0oeCk7XG4gICAgaWYocy5sZW5ndGggIT09IDIgfHwgc1swXSAhPT0gc1sxXSkgeyB0aHJvdyBuZXcgRXJyb3IoJ251bWVyaWM6IGRldCgpIG9ubHkgd29ya3Mgb24gc3F1YXJlIG1hdHJpY2VzJyk7IH1cbiAgICB2YXIgbiA9IHNbMF0sIHJldCA9IDEsaSxqLGssQSA9IG51bWVyaWMuY2xvbmUoeCksQWosQWksYWxwaGEsdGVtcCxrMSxrMixrMztcbiAgICBmb3Ioaj0wO2o8bi0xO2orKykge1xuICAgICAgICBrPWo7XG4gICAgICAgIGZvcihpPWorMTtpPG47aSsrKSB7IGlmKE1hdGguYWJzKEFbaV1bal0pID4gTWF0aC5hYnMoQVtrXVtqXSkpIHsgayA9IGk7IH0gfVxuICAgICAgICBpZihrICE9PSBqKSB7XG4gICAgICAgICAgICB0ZW1wID0gQVtrXTsgQVtrXSA9IEFbal07IEFbal0gPSB0ZW1wO1xuICAgICAgICAgICAgcmV0ICo9IC0xO1xuICAgICAgICB9XG4gICAgICAgIEFqID0gQVtqXTtcbiAgICAgICAgZm9yKGk9aisxO2k8bjtpKyspIHtcbiAgICAgICAgICAgIEFpID0gQVtpXTtcbiAgICAgICAgICAgIGFscGhhID0gQWlbal0vQWpbal07XG4gICAgICAgICAgICBmb3Ioaz1qKzE7azxuLTE7ays9Mikge1xuICAgICAgICAgICAgICAgIGsxID0gaysxO1xuICAgICAgICAgICAgICAgIEFpW2tdIC09IEFqW2tdKmFscGhhO1xuICAgICAgICAgICAgICAgIEFpW2sxXSAtPSBBaltrMV0qYWxwaGE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihrIT09bikgeyBBaVtrXSAtPSBBaltrXSphbHBoYTsgfVxuICAgICAgICB9XG4gICAgICAgIGlmKEFqW2pdID09PSAwKSB7IHJldHVybiAwOyB9XG4gICAgICAgIHJldCAqPSBBaltqXTtcbiAgICB9XG4gICAgcmV0dXJuIHJldCpBW2pdW2pdO1xufVxuXG5udW1lcmljLnRyYW5zcG9zZSA9IGZ1bmN0aW9uIHRyYW5zcG9zZSh4KSB7XG4gICAgdmFyIGksaixtID0geC5sZW5ndGgsbiA9IHhbMF0ubGVuZ3RoLCByZXQ9QXJyYXkobiksQTAsQTEsQmo7XG4gICAgZm9yKGo9MDtqPG47aisrKSByZXRbal0gPSBBcnJheShtKTtcbiAgICBmb3IoaT1tLTE7aT49MTtpLT0yKSB7XG4gICAgICAgIEExID0geFtpXTtcbiAgICAgICAgQTAgPSB4W2ktMV07XG4gICAgICAgIGZvcihqPW4tMTtqPj0xOy0taikge1xuICAgICAgICAgICAgQmogPSByZXRbal07IEJqW2ldID0gQTFbal07IEJqW2ktMV0gPSBBMFtqXTtcbiAgICAgICAgICAgIC0tajtcbiAgICAgICAgICAgIEJqID0gcmV0W2pdOyBCaltpXSA9IEExW2pdOyBCaltpLTFdID0gQTBbal07XG4gICAgICAgIH1cbiAgICAgICAgaWYoaj09PTApIHtcbiAgICAgICAgICAgIEJqID0gcmV0WzBdOyBCaltpXSA9IEExWzBdOyBCaltpLTFdID0gQTBbMF07XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYoaT09PTApIHtcbiAgICAgICAgQTAgPSB4WzBdO1xuICAgICAgICBmb3Ioaj1uLTE7aj49MTstLWopIHtcbiAgICAgICAgICAgIHJldFtqXVswXSA9IEEwW2pdO1xuICAgICAgICAgICAgLS1qO1xuICAgICAgICAgICAgcmV0W2pdWzBdID0gQTBbal07XG4gICAgICAgIH1cbiAgICAgICAgaWYoaj09PTApIHsgcmV0WzBdWzBdID0gQTBbMF07IH1cbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbn1cbm51bWVyaWMubmVndHJhbnNwb3NlID0gZnVuY3Rpb24gbmVndHJhbnNwb3NlKHgpIHtcbiAgICB2YXIgaSxqLG0gPSB4Lmxlbmd0aCxuID0geFswXS5sZW5ndGgsIHJldD1BcnJheShuKSxBMCxBMSxCajtcbiAgICBmb3Ioaj0wO2o8bjtqKyspIHJldFtqXSA9IEFycmF5KG0pO1xuICAgIGZvcihpPW0tMTtpPj0xO2ktPTIpIHtcbiAgICAgICAgQTEgPSB4W2ldO1xuICAgICAgICBBMCA9IHhbaS0xXTtcbiAgICAgICAgZm9yKGo9bi0xO2o+PTE7LS1qKSB7XG4gICAgICAgICAgICBCaiA9IHJldFtqXTsgQmpbaV0gPSAtQTFbal07IEJqW2ktMV0gPSAtQTBbal07XG4gICAgICAgICAgICAtLWo7XG4gICAgICAgICAgICBCaiA9IHJldFtqXTsgQmpbaV0gPSAtQTFbal07IEJqW2ktMV0gPSAtQTBbal07XG4gICAgICAgIH1cbiAgICAgICAgaWYoaj09PTApIHtcbiAgICAgICAgICAgIEJqID0gcmV0WzBdOyBCaltpXSA9IC1BMVswXTsgQmpbaS0xXSA9IC1BMFswXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZihpPT09MCkge1xuICAgICAgICBBMCA9IHhbMF07XG4gICAgICAgIGZvcihqPW4tMTtqPj0xOy0taikge1xuICAgICAgICAgICAgcmV0W2pdWzBdID0gLUEwW2pdO1xuICAgICAgICAgICAgLS1qO1xuICAgICAgICAgICAgcmV0W2pdWzBdID0gLUEwW2pdO1xuICAgICAgICB9XG4gICAgICAgIGlmKGo9PT0wKSB7IHJldFswXVswXSA9IC1BMFswXTsgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0O1xufVxuXG5udW1lcmljLl9yYW5kb20gPSBmdW5jdGlvbiBfcmFuZG9tKHMsaykge1xuICAgIHZhciBpLG49c1trXSxyZXQ9QXJyYXkobiksIHJuZDtcbiAgICBpZihrID09PSBzLmxlbmd0aC0xKSB7XG4gICAgICAgIHJuZCA9IE1hdGgucmFuZG9tO1xuICAgICAgICBmb3IoaT1uLTE7aT49MTtpLT0yKSB7XG4gICAgICAgICAgICByZXRbaV0gPSBybmQoKTtcbiAgICAgICAgICAgIHJldFtpLTFdID0gcm5kKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoaT09PTApIHsgcmV0WzBdID0gcm5kKCk7IH1cbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG4gICAgZm9yKGk9bi0xO2k+PTA7aS0tKSByZXRbaV0gPSBfcmFuZG9tKHMsaysxKTtcbiAgICByZXR1cm4gcmV0O1xufVxubnVtZXJpYy5yYW5kb20gPSBmdW5jdGlvbiByYW5kb20ocykgeyByZXR1cm4gbnVtZXJpYy5fcmFuZG9tKHMsMCk7IH1cblxubnVtZXJpYy5ub3JtMiA9IGZ1bmN0aW9uIG5vcm0yKHgpIHsgcmV0dXJuIE1hdGguc3FydChudW1lcmljLm5vcm0yU3F1YXJlZCh4KSk7IH1cblxubnVtZXJpYy5saW5zcGFjZSA9IGZ1bmN0aW9uIGxpbnNwYWNlKGEsYixuKSB7XG4gICAgaWYodHlwZW9mIG4gPT09IFwidW5kZWZpbmVkXCIpIG4gPSBNYXRoLm1heChNYXRoLnJvdW5kKGItYSkrMSwxKTtcbiAgICBpZihuPDIpIHsgcmV0dXJuIG49PT0xP1thXTpbXTsgfVxuICAgIHZhciBpLHJldCA9IEFycmF5KG4pO1xuICAgIG4tLTtcbiAgICBmb3IoaT1uO2k+PTA7aS0tKSB7IHJldFtpXSA9IChpKmIrKG4taSkqYSkvbjsgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbm51bWVyaWMuZ2V0QmxvY2sgPSBmdW5jdGlvbiBnZXRCbG9jayh4LGZyb20sdG8pIHtcbiAgICB2YXIgcyA9IG51bWVyaWMuZGltKHgpO1xuICAgIGZ1bmN0aW9uIGZvbyh4LGspIHtcbiAgICAgICAgdmFyIGksYSA9IGZyb21ba10sIG4gPSB0b1trXS1hLCByZXQgPSBBcnJheShuKTtcbiAgICAgICAgaWYoayA9PT0gcy5sZW5ndGgtMSkge1xuICAgICAgICAgICAgZm9yKGk9bjtpPj0wO2ktLSkgeyByZXRbaV0gPSB4W2krYV07IH1cbiAgICAgICAgICAgIHJldHVybiByZXQ7XG4gICAgICAgIH1cbiAgICAgICAgZm9yKGk9bjtpPj0wO2ktLSkgeyByZXRbaV0gPSBmb28oeFtpK2FdLGsrMSk7IH1cbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG4gICAgcmV0dXJuIGZvbyh4LDApO1xufVxuXG5udW1lcmljLnNldEJsb2NrID0gZnVuY3Rpb24gc2V0QmxvY2soeCxmcm9tLHRvLEIpIHtcbiAgICB2YXIgcyA9IG51bWVyaWMuZGltKHgpO1xuICAgIGZ1bmN0aW9uIGZvbyh4LHksaykge1xuICAgICAgICB2YXIgaSxhID0gZnJvbVtrXSwgbiA9IHRvW2tdLWE7XG4gICAgICAgIGlmKGsgPT09IHMubGVuZ3RoLTEpIHsgZm9yKGk9bjtpPj0wO2ktLSkgeyB4W2krYV0gPSB5W2ldOyB9IH1cbiAgICAgICAgZm9yKGk9bjtpPj0wO2ktLSkgeyBmb28oeFtpK2FdLHlbaV0saysxKTsgfVxuICAgIH1cbiAgICBmb28oeCxCLDApO1xuICAgIHJldHVybiB4O1xufVxuXG5udW1lcmljLmdldFJhbmdlID0gZnVuY3Rpb24gZ2V0UmFuZ2UoQSxJLEopIHtcbiAgICB2YXIgbSA9IEkubGVuZ3RoLCBuID0gSi5sZW5ndGg7XG4gICAgdmFyIGksajtcbiAgICB2YXIgQiA9IEFycmF5KG0pLCBCaSwgQUk7XG4gICAgZm9yKGk9bS0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgQltpXSA9IEFycmF5KG4pO1xuICAgICAgICBCaSA9IEJbaV07XG4gICAgICAgIEFJID0gQVtJW2ldXTtcbiAgICAgICAgZm9yKGo9bi0xO2ohPT0tMTstLWopIEJpW2pdID0gQUlbSltqXV07XG4gICAgfVxuICAgIHJldHVybiBCO1xufVxuXG5udW1lcmljLmJsb2NrTWF0cml4ID0gZnVuY3Rpb24gYmxvY2tNYXRyaXgoWCkge1xuICAgIHZhciBzID0gbnVtZXJpYy5kaW0oWCk7XG4gICAgaWYocy5sZW5ndGg8NCkgcmV0dXJuIG51bWVyaWMuYmxvY2tNYXRyaXgoW1hdKTtcbiAgICB2YXIgbT1zWzBdLG49c1sxXSxNLE4saSxqLFhpajtcbiAgICBNID0gMDsgTiA9IDA7XG4gICAgZm9yKGk9MDtpPG07KytpKSBNKz1YW2ldWzBdLmxlbmd0aDtcbiAgICBmb3Ioaj0wO2o8bjsrK2opIE4rPVhbMF1bal1bMF0ubGVuZ3RoO1xuICAgIHZhciBaID0gQXJyYXkoTSk7XG4gICAgZm9yKGk9MDtpPE07KytpKSBaW2ldID0gQXJyYXkoTik7XG4gICAgdmFyIEk9MCxKLFpJLGssbCxYaWprO1xuICAgIGZvcihpPTA7aTxtOysraSkge1xuICAgICAgICBKPU47XG4gICAgICAgIGZvcihqPW4tMTtqIT09LTE7LS1qKSB7XG4gICAgICAgICAgICBYaWogPSBYW2ldW2pdO1xuICAgICAgICAgICAgSiAtPSBYaWpbMF0ubGVuZ3RoO1xuICAgICAgICAgICAgZm9yKGs9WGlqLmxlbmd0aC0xO2shPT0tMTstLWspIHtcbiAgICAgICAgICAgICAgICBYaWprID0gWGlqW2tdO1xuICAgICAgICAgICAgICAgIFpJID0gWltJK2tdO1xuICAgICAgICAgICAgICAgIGZvcihsID0gWGlqay5sZW5ndGgtMTtsIT09LTE7LS1sKSBaSVtKK2xdID0gWGlqa1tsXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBJICs9IFhbaV1bMF0ubGVuZ3RoO1xuICAgIH1cbiAgICByZXR1cm4gWjtcbn1cblxubnVtZXJpYy50ZW5zb3IgPSBmdW5jdGlvbiB0ZW5zb3IoeCx5KSB7XG4gICAgaWYodHlwZW9mIHggPT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHkgPT09IFwibnVtYmVyXCIpIHJldHVybiBudW1lcmljLm11bCh4LHkpO1xuICAgIHZhciBzMSA9IG51bWVyaWMuZGltKHgpLCBzMiA9IG51bWVyaWMuZGltKHkpO1xuICAgIGlmKHMxLmxlbmd0aCAhPT0gMSB8fCBzMi5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdudW1lcmljOiB0ZW5zb3IgcHJvZHVjdCBpcyBvbmx5IGRlZmluZWQgZm9yIHZlY3RvcnMnKTtcbiAgICB9XG4gICAgdmFyIG0gPSBzMVswXSwgbiA9IHMyWzBdLCBBID0gQXJyYXkobSksIEFpLCBpLGoseGk7XG4gICAgZm9yKGk9bS0xO2k+PTA7aS0tKSB7XG4gICAgICAgIEFpID0gQXJyYXkobik7XG4gICAgICAgIHhpID0geFtpXTtcbiAgICAgICAgZm9yKGo9bi0xO2o+PTM7LS1qKSB7XG4gICAgICAgICAgICBBaVtqXSA9IHhpICogeVtqXTtcbiAgICAgICAgICAgIC0tajtcbiAgICAgICAgICAgIEFpW2pdID0geGkgKiB5W2pdO1xuICAgICAgICAgICAgLS1qO1xuICAgICAgICAgICAgQWlbal0gPSB4aSAqIHlbal07XG4gICAgICAgICAgICAtLWo7XG4gICAgICAgICAgICBBaVtqXSA9IHhpICogeVtqXTtcbiAgICAgICAgfVxuICAgICAgICB3aGlsZShqPj0wKSB7IEFpW2pdID0geGkgKiB5W2pdOyAtLWo7IH1cbiAgICAgICAgQVtpXSA9IEFpO1xuICAgIH1cbiAgICByZXR1cm4gQTtcbn1cblxuLy8gMy4gVGhlIFRlbnNvciB0eXBlIFRcbm51bWVyaWMuVCA9IGZ1bmN0aW9uIFQoeCx5KSB7IHRoaXMueCA9IHg7IHRoaXMueSA9IHk7IH1cbm51bWVyaWMudCA9IGZ1bmN0aW9uIHQoeCx5KSB7IHJldHVybiBuZXcgbnVtZXJpYy5UKHgseSk7IH1cblxubnVtZXJpYy5UYmlub3AgPSBmdW5jdGlvbiBUYmlub3AocnIscmMsY3IsY2Msc2V0dXApIHtcbiAgICB2YXIgaW8gPSBudW1lcmljLmluZGV4T2Y7XG4gICAgaWYodHlwZW9mIHNldHVwICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHZhciBrO1xuICAgICAgICBzZXR1cCA9ICcnO1xuICAgICAgICBmb3IoayBpbiBudW1lcmljKSB7XG4gICAgICAgICAgICBpZihudW1lcmljLmhhc093blByb3BlcnR5KGspICYmIChyci5pbmRleE9mKGspPj0wIHx8IHJjLmluZGV4T2Yoayk+PTAgfHwgY3IuaW5kZXhPZihrKT49MCB8fCBjYy5pbmRleE9mKGspPj0wKSAmJiBrLmxlbmd0aD4xKSB7XG4gICAgICAgICAgICAgICAgc2V0dXAgKz0gJ3ZhciAnK2srJyA9IG51bWVyaWMuJytrKyc7XFxuJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gRnVuY3Rpb24oWyd5J10sXG4gICAgICAgICAgICAndmFyIHggPSB0aGlzO1xcbicrXG4gICAgICAgICAgICAnaWYoISh5IGluc3RhbmNlb2YgbnVtZXJpYy5UKSkgeyB5ID0gbmV3IG51bWVyaWMuVCh5KTsgfVxcbicrXG4gICAgICAgICAgICBzZXR1cCsnXFxuJytcbiAgICAgICAgICAgICdpZih4LnkpIHsnK1xuICAgICAgICAgICAgJyAgaWYoeS55KSB7JytcbiAgICAgICAgICAgICcgICAgcmV0dXJuIG5ldyBudW1lcmljLlQoJytjYysnKTtcXG4nK1xuICAgICAgICAgICAgJyAgfVxcbicrXG4gICAgICAgICAgICAnICByZXR1cm4gbmV3IG51bWVyaWMuVCgnK2NyKycpO1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICAnaWYoeS55KSB7XFxuJytcbiAgICAgICAgICAgICcgIHJldHVybiBuZXcgbnVtZXJpYy5UKCcrcmMrJyk7XFxuJytcbiAgICAgICAgICAgICd9XFxuJytcbiAgICAgICAgICAgICdyZXR1cm4gbmV3IG51bWVyaWMuVCgnK3JyKycpO1xcbidcbiAgICApO1xufVxuXG5udW1lcmljLlQucHJvdG90eXBlLmFkZCA9IG51bWVyaWMuVGJpbm9wKFxuICAgICAgICAnYWRkKHgueCx5LngpJyxcbiAgICAgICAgJ2FkZCh4LngseS54KSx5LnknLFxuICAgICAgICAnYWRkKHgueCx5LngpLHgueScsXG4gICAgICAgICdhZGQoeC54LHkueCksYWRkKHgueSx5LnkpJyk7XG5udW1lcmljLlQucHJvdG90eXBlLnN1YiA9IG51bWVyaWMuVGJpbm9wKFxuICAgICAgICAnc3ViKHgueCx5LngpJyxcbiAgICAgICAgJ3N1Yih4LngseS54KSxuZWcoeS55KScsXG4gICAgICAgICdzdWIoeC54LHkueCkseC55JyxcbiAgICAgICAgJ3N1Yih4LngseS54KSxzdWIoeC55LHkueSknKTtcbm51bWVyaWMuVC5wcm90b3R5cGUubXVsID0gbnVtZXJpYy5UYmlub3AoXG4gICAgICAgICdtdWwoeC54LHkueCknLFxuICAgICAgICAnbXVsKHgueCx5LngpLG11bCh4LngseS55KScsXG4gICAgICAgICdtdWwoeC54LHkueCksbXVsKHgueSx5LngpJyxcbiAgICAgICAgJ3N1YihtdWwoeC54LHkueCksbXVsKHgueSx5LnkpKSxhZGQobXVsKHgueCx5LnkpLG11bCh4LnkseS54KSknKTtcblxubnVtZXJpYy5ULnByb3RvdHlwZS5yZWNpcHJvY2FsID0gZnVuY3Rpb24gcmVjaXByb2NhbCgpIHtcbiAgICB2YXIgbXVsID0gbnVtZXJpYy5tdWwsIGRpdiA9IG51bWVyaWMuZGl2O1xuICAgIGlmKHRoaXMueSkge1xuICAgICAgICB2YXIgZCA9IG51bWVyaWMuYWRkKG11bCh0aGlzLngsdGhpcy54KSxtdWwodGhpcy55LHRoaXMueSkpO1xuICAgICAgICByZXR1cm4gbmV3IG51bWVyaWMuVChkaXYodGhpcy54LGQpLGRpdihudW1lcmljLm5lZyh0aGlzLnkpLGQpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBUKGRpdigxLHRoaXMueCkpO1xufVxubnVtZXJpYy5ULnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbiBkaXYoeSkge1xuICAgIGlmKCEoeSBpbnN0YW5jZW9mIG51bWVyaWMuVCkpIHkgPSBuZXcgbnVtZXJpYy5UKHkpO1xuICAgIGlmKHkueSkgeyByZXR1cm4gdGhpcy5tdWwoeS5yZWNpcHJvY2FsKCkpOyB9XG4gICAgdmFyIGRpdiA9IG51bWVyaWMuZGl2O1xuICAgIGlmKHRoaXMueSkgeyByZXR1cm4gbmV3IG51bWVyaWMuVChkaXYodGhpcy54LHkueCksZGl2KHRoaXMueSx5LngpKTsgfVxuICAgIHJldHVybiBuZXcgbnVtZXJpYy5UKGRpdih0aGlzLngseS54KSk7XG59XG5udW1lcmljLlQucHJvdG90eXBlLmRvdCA9IG51bWVyaWMuVGJpbm9wKFxuICAgICAgICAnZG90KHgueCx5LngpJyxcbiAgICAgICAgJ2RvdCh4LngseS54KSxkb3QoeC54LHkueSknLFxuICAgICAgICAnZG90KHgueCx5LngpLGRvdCh4LnkseS54KScsXG4gICAgICAgICdzdWIoZG90KHgueCx5LngpLGRvdCh4LnkseS55KSksYWRkKGRvdCh4LngseS55KSxkb3QoeC55LHkueCkpJ1xuICAgICAgICApO1xubnVtZXJpYy5ULnByb3RvdHlwZS50cmFuc3Bvc2UgPSBmdW5jdGlvbiB0cmFuc3Bvc2UoKSB7XG4gICAgdmFyIHQgPSBudW1lcmljLnRyYW5zcG9zZSwgeCA9IHRoaXMueCwgeSA9IHRoaXMueTtcbiAgICBpZih5KSB7IHJldHVybiBuZXcgbnVtZXJpYy5UKHQoeCksdCh5KSk7IH1cbiAgICByZXR1cm4gbmV3IG51bWVyaWMuVCh0KHgpKTtcbn1cbm51bWVyaWMuVC5wcm90b3R5cGUudHJhbnNqdWdhdGUgPSBmdW5jdGlvbiB0cmFuc2p1Z2F0ZSgpIHtcbiAgICB2YXIgdCA9IG51bWVyaWMudHJhbnNwb3NlLCB4ID0gdGhpcy54LCB5ID0gdGhpcy55O1xuICAgIGlmKHkpIHsgcmV0dXJuIG5ldyBudW1lcmljLlQodCh4KSxudW1lcmljLm5lZ3RyYW5zcG9zZSh5KSk7IH1cbiAgICByZXR1cm4gbmV3IG51bWVyaWMuVCh0KHgpKTtcbn1cbm51bWVyaWMuVHVub3AgPSBmdW5jdGlvbiBUdW5vcChyLGMscykge1xuICAgIGlmKHR5cGVvZiBzICE9PSBcInN0cmluZ1wiKSB7IHMgPSAnJzsgfVxuICAgIHJldHVybiBGdW5jdGlvbihcbiAgICAgICAgICAgICd2YXIgeCA9IHRoaXM7XFxuJytcbiAgICAgICAgICAgIHMrJ1xcbicrXG4gICAgICAgICAgICAnaWYoeC55KSB7JytcbiAgICAgICAgICAgICcgICcrYysnO1xcbicrXG4gICAgICAgICAgICAnfVxcbicrXG4gICAgICAgICAgICByKyc7XFxuJ1xuICAgICk7XG59XG5cbm51bWVyaWMuVC5wcm90b3R5cGUuZXhwID0gbnVtZXJpYy5UdW5vcChcbiAgICAgICAgJ3JldHVybiBuZXcgbnVtZXJpYy5UKGV4KScsXG4gICAgICAgICdyZXR1cm4gbmV3IG51bWVyaWMuVChtdWwoY29zKHgueSksZXgpLG11bChzaW4oeC55KSxleCkpJyxcbiAgICAgICAgJ3ZhciBleCA9IG51bWVyaWMuZXhwKHgueCksIGNvcyA9IG51bWVyaWMuY29zLCBzaW4gPSBudW1lcmljLnNpbiwgbXVsID0gbnVtZXJpYy5tdWw7Jyk7XG5udW1lcmljLlQucHJvdG90eXBlLmNvbmogPSBudW1lcmljLlR1bm9wKFxuICAgICAgICAncmV0dXJuIG5ldyBudW1lcmljLlQoeC54KTsnLFxuICAgICAgICAncmV0dXJuIG5ldyBudW1lcmljLlQoeC54LG51bWVyaWMubmVnKHgueSkpOycpO1xubnVtZXJpYy5ULnByb3RvdHlwZS5uZWcgPSBudW1lcmljLlR1bm9wKFxuICAgICAgICAncmV0dXJuIG5ldyBudW1lcmljLlQobmVnKHgueCkpOycsXG4gICAgICAgICdyZXR1cm4gbmV3IG51bWVyaWMuVChuZWcoeC54KSxuZWcoeC55KSk7JyxcbiAgICAgICAgJ3ZhciBuZWcgPSBudW1lcmljLm5lZzsnKTtcbm51bWVyaWMuVC5wcm90b3R5cGUuc2luID0gbnVtZXJpYy5UdW5vcChcbiAgICAgICAgJ3JldHVybiBuZXcgbnVtZXJpYy5UKG51bWVyaWMuc2luKHgueCkpJyxcbiAgICAgICAgJ3JldHVybiB4LmV4cCgpLnN1Yih4Lm5lZygpLmV4cCgpKS5kaXYobmV3IG51bWVyaWMuVCgwLDIpKTsnKTtcbm51bWVyaWMuVC5wcm90b3R5cGUuY29zID0gbnVtZXJpYy5UdW5vcChcbiAgICAgICAgJ3JldHVybiBuZXcgbnVtZXJpYy5UKG51bWVyaWMuY29zKHgueCkpJyxcbiAgICAgICAgJ3JldHVybiB4LmV4cCgpLmFkZCh4Lm5lZygpLmV4cCgpKS5kaXYoMik7Jyk7XG5udW1lcmljLlQucHJvdG90eXBlLmFicyA9IG51bWVyaWMuVHVub3AoXG4gICAgICAgICdyZXR1cm4gbmV3IG51bWVyaWMuVChudW1lcmljLmFicyh4LngpKTsnLFxuICAgICAgICAncmV0dXJuIG5ldyBudW1lcmljLlQobnVtZXJpYy5zcXJ0KG51bWVyaWMuYWRkKG11bCh4LngseC54KSxtdWwoeC55LHgueSkpKSk7JyxcbiAgICAgICAgJ3ZhciBtdWwgPSBudW1lcmljLm11bDsnKTtcbm51bWVyaWMuVC5wcm90b3R5cGUubG9nID0gbnVtZXJpYy5UdW5vcChcbiAgICAgICAgJ3JldHVybiBuZXcgbnVtZXJpYy5UKG51bWVyaWMubG9nKHgueCkpOycsXG4gICAgICAgICd2YXIgdGhldGEgPSBuZXcgbnVtZXJpYy5UKG51bWVyaWMuYXRhbjIoeC55LHgueCkpLCByID0geC5hYnMoKTtcXG4nK1xuICAgICAgICAncmV0dXJuIG5ldyBudW1lcmljLlQobnVtZXJpYy5sb2coci54KSx0aGV0YS54KTsnKTtcbm51bWVyaWMuVC5wcm90b3R5cGUubm9ybTIgPSBudW1lcmljLlR1bm9wKFxuICAgICAgICAncmV0dXJuIG51bWVyaWMubm9ybTIoeC54KTsnLFxuICAgICAgICAndmFyIGYgPSBudW1lcmljLm5vcm0yU3F1YXJlZDtcXG4nK1xuICAgICAgICAncmV0dXJuIE1hdGguc3FydChmKHgueCkrZih4LnkpKTsnKTtcbm51bWVyaWMuVC5wcm90b3R5cGUuaW52ID0gZnVuY3Rpb24gaW52KCkge1xuICAgIHZhciBBID0gdGhpcztcbiAgICBpZih0eXBlb2YgQS55ID09PSBcInVuZGVmaW5lZFwiKSB7IHJldHVybiBuZXcgbnVtZXJpYy5UKG51bWVyaWMuaW52KEEueCkpOyB9XG4gICAgdmFyIG4gPSBBLngubGVuZ3RoLCBpLCBqLCBrO1xuICAgIHZhciBSeCA9IG51bWVyaWMuaWRlbnRpdHkobiksUnkgPSBudW1lcmljLnJlcChbbixuXSwwKTtcbiAgICB2YXIgQXggPSBudW1lcmljLmNsb25lKEEueCksIEF5ID0gbnVtZXJpYy5jbG9uZShBLnkpO1xuICAgIHZhciBBaXgsIEFpeSwgQWp4LCBBanksIFJpeCwgUml5LCBSangsIFJqeTtcbiAgICB2YXIgaSxqLGssZCxkMSxheCxheSxieCxieSx0ZW1wO1xuICAgIGZvcihpPTA7aTxuO2krKykge1xuICAgICAgICBheCA9IEF4W2ldW2ldOyBheSA9IEF5W2ldW2ldO1xuICAgICAgICBkID0gYXgqYXgrYXkqYXk7XG4gICAgICAgIGsgPSBpO1xuICAgICAgICBmb3Ioaj1pKzE7ajxuO2orKykge1xuICAgICAgICAgICAgYXggPSBBeFtqXVtpXTsgYXkgPSBBeVtqXVtpXTtcbiAgICAgICAgICAgIGQxID0gYXgqYXgrYXkqYXk7XG4gICAgICAgICAgICBpZihkMSA+IGQpIHsgaz1qOyBkID0gZDE7IH1cbiAgICAgICAgfVxuICAgICAgICBpZihrIT09aSkge1xuICAgICAgICAgICAgdGVtcCA9IEF4W2ldOyBBeFtpXSA9IEF4W2tdOyBBeFtrXSA9IHRlbXA7XG4gICAgICAgICAgICB0ZW1wID0gQXlbaV07IEF5W2ldID0gQXlba107IEF5W2tdID0gdGVtcDtcbiAgICAgICAgICAgIHRlbXAgPSBSeFtpXTsgUnhbaV0gPSBSeFtrXTsgUnhba10gPSB0ZW1wO1xuICAgICAgICAgICAgdGVtcCA9IFJ5W2ldOyBSeVtpXSA9IFJ5W2tdOyBSeVtrXSA9IHRlbXA7XG4gICAgICAgIH1cbiAgICAgICAgQWl4ID0gQXhbaV07IEFpeSA9IEF5W2ldO1xuICAgICAgICBSaXggPSBSeFtpXTsgUml5ID0gUnlbaV07XG4gICAgICAgIGF4ID0gQWl4W2ldOyBheSA9IEFpeVtpXTtcbiAgICAgICAgZm9yKGo9aSsxO2o8bjtqKyspIHtcbiAgICAgICAgICAgIGJ4ID0gQWl4W2pdOyBieSA9IEFpeVtqXTtcbiAgICAgICAgICAgIEFpeFtqXSA9IChieCpheCtieSpheSkvZDtcbiAgICAgICAgICAgIEFpeVtqXSA9IChieSpheC1ieCpheSkvZDtcbiAgICAgICAgfVxuICAgICAgICBmb3Ioaj0wO2o8bjtqKyspIHtcbiAgICAgICAgICAgIGJ4ID0gUml4W2pdOyBieSA9IFJpeVtqXTtcbiAgICAgICAgICAgIFJpeFtqXSA9IChieCpheCtieSpheSkvZDtcbiAgICAgICAgICAgIFJpeVtqXSA9IChieSpheC1ieCpheSkvZDtcbiAgICAgICAgfVxuICAgICAgICBmb3Ioaj1pKzE7ajxuO2orKykge1xuICAgICAgICAgICAgQWp4ID0gQXhbal07IEFqeSA9IEF5W2pdO1xuICAgICAgICAgICAgUmp4ID0gUnhbal07IFJqeSA9IFJ5W2pdO1xuICAgICAgICAgICAgYXggPSBBanhbaV07IGF5ID0gQWp5W2ldO1xuICAgICAgICAgICAgZm9yKGs9aSsxO2s8bjtrKyspIHtcbiAgICAgICAgICAgICAgICBieCA9IEFpeFtrXTsgYnkgPSBBaXlba107XG4gICAgICAgICAgICAgICAgQWp4W2tdIC09IGJ4KmF4LWJ5KmF5O1xuICAgICAgICAgICAgICAgIEFqeVtrXSAtPSBieSpheCtieCpheTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvcihrPTA7azxuO2srKykge1xuICAgICAgICAgICAgICAgIGJ4ID0gUml4W2tdOyBieSA9IFJpeVtrXTtcbiAgICAgICAgICAgICAgICBSanhba10gLT0gYngqYXgtYnkqYXk7XG4gICAgICAgICAgICAgICAgUmp5W2tdIC09IGJ5KmF4K2J4KmF5O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGZvcihpPW4tMTtpPjA7aS0tKSB7XG4gICAgICAgIFJpeCA9IFJ4W2ldOyBSaXkgPSBSeVtpXTtcbiAgICAgICAgZm9yKGo9aS0xO2o+PTA7ai0tKSB7XG4gICAgICAgICAgICBSanggPSBSeFtqXTsgUmp5ID0gUnlbal07XG4gICAgICAgICAgICBheCA9IEF4W2pdW2ldOyBheSA9IEF5W2pdW2ldO1xuICAgICAgICAgICAgZm9yKGs9bi0xO2s+PTA7ay0tKSB7XG4gICAgICAgICAgICAgICAgYnggPSBSaXhba107IGJ5ID0gUml5W2tdO1xuICAgICAgICAgICAgICAgIFJqeFtrXSAtPSBheCpieCAtIGF5KmJ5O1xuICAgICAgICAgICAgICAgIFJqeVtrXSAtPSBheCpieSArIGF5KmJ4O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBuZXcgbnVtZXJpYy5UKFJ4LFJ5KTtcbn1cbm51bWVyaWMuVC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0KGkpIHtcbiAgICB2YXIgeCA9IHRoaXMueCwgeSA9IHRoaXMueSwgayA9IDAsIGlrLCBuID0gaS5sZW5ndGg7XG4gICAgaWYoeSkge1xuICAgICAgICB3aGlsZShrPG4pIHtcbiAgICAgICAgICAgIGlrID0gaVtrXTtcbiAgICAgICAgICAgIHggPSB4W2lrXTtcbiAgICAgICAgICAgIHkgPSB5W2lrXTtcbiAgICAgICAgICAgIGsrKztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IG51bWVyaWMuVCh4LHkpO1xuICAgIH1cbiAgICB3aGlsZShrPG4pIHtcbiAgICAgICAgaWsgPSBpW2tdO1xuICAgICAgICB4ID0geFtpa107XG4gICAgICAgIGsrKztcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBudW1lcmljLlQoeCk7XG59XG5udW1lcmljLlQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldChpLHYpIHtcbiAgICB2YXIgeCA9IHRoaXMueCwgeSA9IHRoaXMueSwgayA9IDAsIGlrLCBuID0gaS5sZW5ndGgsIHZ4ID0gdi54LCB2eSA9IHYueTtcbiAgICBpZihuPT09MCkge1xuICAgICAgICBpZih2eSkgeyB0aGlzLnkgPSB2eTsgfVxuICAgICAgICBlbHNlIGlmKHkpIHsgdGhpcy55ID0gdW5kZWZpbmVkOyB9XG4gICAgICAgIHRoaXMueCA9IHg7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBpZih2eSkge1xuICAgICAgICBpZih5KSB7IC8qIG9rICovIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB5ID0gbnVtZXJpYy5yZXAobnVtZXJpYy5kaW0oeCksMCk7XG4gICAgICAgICAgICB0aGlzLnkgPSB5O1xuICAgICAgICB9XG4gICAgICAgIHdoaWxlKGs8bi0xKSB7XG4gICAgICAgICAgICBpayA9IGlba107XG4gICAgICAgICAgICB4ID0geFtpa107XG4gICAgICAgICAgICB5ID0geVtpa107XG4gICAgICAgICAgICBrKys7XG4gICAgICAgIH1cbiAgICAgICAgaWsgPSBpW2tdO1xuICAgICAgICB4W2lrXSA9IHZ4O1xuICAgICAgICB5W2lrXSA9IHZ5O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgaWYoeSkge1xuICAgICAgICB3aGlsZShrPG4tMSkge1xuICAgICAgICAgICAgaWsgPSBpW2tdO1xuICAgICAgICAgICAgeCA9IHhbaWtdO1xuICAgICAgICAgICAgeSA9IHlbaWtdO1xuICAgICAgICAgICAgaysrO1xuICAgICAgICB9XG4gICAgICAgIGlrID0gaVtrXTtcbiAgICAgICAgeFtpa10gPSB2eDtcbiAgICAgICAgaWYodnggaW5zdGFuY2VvZiBBcnJheSkgeVtpa10gPSBudW1lcmljLnJlcChudW1lcmljLmRpbSh2eCksMCk7XG4gICAgICAgIGVsc2UgeVtpa10gPSAwO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgd2hpbGUoazxuLTEpIHtcbiAgICAgICAgaWsgPSBpW2tdO1xuICAgICAgICB4ID0geFtpa107XG4gICAgICAgIGsrKztcbiAgICB9XG4gICAgaWsgPSBpW2tdO1xuICAgIHhbaWtdID0gdng7XG4gICAgcmV0dXJuIHRoaXM7XG59XG5udW1lcmljLlQucHJvdG90eXBlLmdldFJvd3MgPSBmdW5jdGlvbiBnZXRSb3dzKGkwLGkxKSB7XG4gICAgdmFyIG4gPSBpMS1pMCsxLCBqO1xuICAgIHZhciByeCA9IEFycmF5KG4pLCByeSwgeCA9IHRoaXMueCwgeSA9IHRoaXMueTtcbiAgICBmb3Ioaj1pMDtqPD1pMTtqKyspIHsgcnhbai1pMF0gPSB4W2pdOyB9XG4gICAgaWYoeSkge1xuICAgICAgICByeSA9IEFycmF5KG4pO1xuICAgICAgICBmb3Ioaj1pMDtqPD1pMTtqKyspIHsgcnlbai1pMF0gPSB5W2pdOyB9XG4gICAgICAgIHJldHVybiBuZXcgbnVtZXJpYy5UKHJ4LHJ5KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBudW1lcmljLlQocngpO1xufVxubnVtZXJpYy5ULnByb3RvdHlwZS5zZXRSb3dzID0gZnVuY3Rpb24gc2V0Um93cyhpMCxpMSxBKSB7XG4gICAgdmFyIGo7XG4gICAgdmFyIHJ4ID0gdGhpcy54LCByeSA9IHRoaXMueSwgeCA9IEEueCwgeSA9IEEueTtcbiAgICBmb3Ioaj1pMDtqPD1pMTtqKyspIHsgcnhbal0gPSB4W2otaTBdOyB9XG4gICAgaWYoeSkge1xuICAgICAgICBpZighcnkpIHsgcnkgPSBudW1lcmljLnJlcChudW1lcmljLmRpbShyeCksMCk7IHRoaXMueSA9IHJ5OyB9XG4gICAgICAgIGZvcihqPWkwO2o8PWkxO2orKykgeyByeVtqXSA9IHlbai1pMF07IH1cbiAgICB9IGVsc2UgaWYocnkpIHtcbiAgICAgICAgZm9yKGo9aTA7ajw9aTE7aisrKSB7IHJ5W2pdID0gbnVtZXJpYy5yZXAoW3hbai1pMF0ubGVuZ3RoXSwwKTsgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbn1cbm51bWVyaWMuVC5wcm90b3R5cGUuZ2V0Um93ID0gZnVuY3Rpb24gZ2V0Um93KGspIHtcbiAgICB2YXIgeCA9IHRoaXMueCwgeSA9IHRoaXMueTtcbiAgICBpZih5KSB7IHJldHVybiBuZXcgbnVtZXJpYy5UKHhba10seVtrXSk7IH1cbiAgICByZXR1cm4gbmV3IG51bWVyaWMuVCh4W2tdKTtcbn1cbm51bWVyaWMuVC5wcm90b3R5cGUuc2V0Um93ID0gZnVuY3Rpb24gc2V0Um93KGksdikge1xuICAgIHZhciByeCA9IHRoaXMueCwgcnkgPSB0aGlzLnksIHggPSB2LngsIHkgPSB2Lnk7XG4gICAgcnhbaV0gPSB4O1xuICAgIGlmKHkpIHtcbiAgICAgICAgaWYoIXJ5KSB7IHJ5ID0gbnVtZXJpYy5yZXAobnVtZXJpYy5kaW0ocngpLDApOyB0aGlzLnkgPSByeTsgfVxuICAgICAgICByeVtpXSA9IHk7XG4gICAgfSBlbHNlIGlmKHJ5KSB7XG4gICAgICAgIHJ5ID0gbnVtZXJpYy5yZXAoW3gubGVuZ3RoXSwwKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG59XG5cbm51bWVyaWMuVC5wcm90b3R5cGUuZ2V0QmxvY2sgPSBmdW5jdGlvbiBnZXRCbG9jayhmcm9tLHRvKSB7XG4gICAgdmFyIHggPSB0aGlzLngsIHkgPSB0aGlzLnksIGIgPSBudW1lcmljLmdldEJsb2NrO1xuICAgIGlmKHkpIHsgcmV0dXJuIG5ldyBudW1lcmljLlQoYih4LGZyb20sdG8pLGIoeSxmcm9tLHRvKSk7IH1cbiAgICByZXR1cm4gbmV3IG51bWVyaWMuVChiKHgsZnJvbSx0bykpO1xufVxubnVtZXJpYy5ULnByb3RvdHlwZS5zZXRCbG9jayA9IGZ1bmN0aW9uIHNldEJsb2NrKGZyb20sdG8sQSkge1xuICAgIGlmKCEoQSBpbnN0YW5jZW9mIG51bWVyaWMuVCkpIEEgPSBuZXcgbnVtZXJpYy5UKEEpO1xuICAgIHZhciB4ID0gdGhpcy54LCB5ID0gdGhpcy55LCBiID0gbnVtZXJpYy5zZXRCbG9jaywgQXggPSBBLngsIEF5ID0gQS55O1xuICAgIGlmKEF5KSB7XG4gICAgICAgIGlmKCF5KSB7IHRoaXMueSA9IG51bWVyaWMucmVwKG51bWVyaWMuZGltKHRoaXMpLDApOyB5ID0gdGhpcy55OyB9XG4gICAgICAgIGIoeCxmcm9tLHRvLEF4KTtcbiAgICAgICAgYih5LGZyb20sdG8sQXkpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgYih4LGZyb20sdG8sQXgpO1xuICAgIGlmKHkpIGIoeSxmcm9tLHRvLG51bWVyaWMucmVwKG51bWVyaWMuZGltKEF4KSwwKSk7XG59XG5udW1lcmljLlQucmVwID0gZnVuY3Rpb24gcmVwKHMsdikge1xuICAgIHZhciBUID0gbnVtZXJpYy5UO1xuICAgIGlmKCEodiBpbnN0YW5jZW9mIFQpKSB2ID0gbmV3IFQodik7XG4gICAgdmFyIHggPSB2LngsIHkgPSB2LnksIHIgPSBudW1lcmljLnJlcDtcbiAgICBpZih5KSByZXR1cm4gbmV3IFQocihzLHgpLHIocyx5KSk7XG4gICAgcmV0dXJuIG5ldyBUKHIocyx4KSk7XG59XG5udW1lcmljLlQuZGlhZyA9IGZ1bmN0aW9uIGRpYWcoZCkge1xuICAgIGlmKCEoZCBpbnN0YW5jZW9mIG51bWVyaWMuVCkpIGQgPSBuZXcgbnVtZXJpYy5UKGQpO1xuICAgIHZhciB4ID0gZC54LCB5ID0gZC55LCBkaWFnID0gbnVtZXJpYy5kaWFnO1xuICAgIGlmKHkpIHJldHVybiBuZXcgbnVtZXJpYy5UKGRpYWcoeCksZGlhZyh5KSk7XG4gICAgcmV0dXJuIG5ldyBudW1lcmljLlQoZGlhZyh4KSk7XG59XG5udW1lcmljLlQuZWlnID0gZnVuY3Rpb24gZWlnKCkge1xuICAgIGlmKHRoaXMueSkgeyB0aHJvdyBuZXcgRXJyb3IoJ2VpZzogbm90IGltcGxlbWVudGVkIGZvciBjb21wbGV4IG1hdHJpY2VzLicpOyB9XG4gICAgcmV0dXJuIG51bWVyaWMuZWlnKHRoaXMueCk7XG59XG5udW1lcmljLlQuaWRlbnRpdHkgPSBmdW5jdGlvbiBpZGVudGl0eShuKSB7IHJldHVybiBuZXcgbnVtZXJpYy5UKG51bWVyaWMuaWRlbnRpdHkobikpOyB9XG5udW1lcmljLlQucHJvdG90eXBlLmdldERpYWcgPSBmdW5jdGlvbiBnZXREaWFnKCkge1xuICAgIHZhciBuID0gbnVtZXJpYztcbiAgICB2YXIgeCA9IHRoaXMueCwgeSA9IHRoaXMueTtcbiAgICBpZih5KSB7IHJldHVybiBuZXcgbi5UKG4uZ2V0RGlhZyh4KSxuLmdldERpYWcoeSkpOyB9XG4gICAgcmV0dXJuIG5ldyBuLlQobi5nZXREaWFnKHgpKTtcbn1cblxuLy8gNC4gRWlnZW52YWx1ZXMgb2YgcmVhbCBtYXRyaWNlc1xuXG5udW1lcmljLmhvdXNlID0gZnVuY3Rpb24gaG91c2UoeCkge1xuICAgIHZhciB2ID0gbnVtZXJpYy5jbG9uZSh4KTtcbiAgICB2YXIgcyA9IHhbMF0gPj0gMCA/IDEgOiAtMTtcbiAgICB2YXIgYWxwaGEgPSBzKm51bWVyaWMubm9ybTIoeCk7XG4gICAgdlswXSArPSBhbHBoYTtcbiAgICB2YXIgZm9vID0gbnVtZXJpYy5ub3JtMih2KTtcbiAgICBpZihmb28gPT09IDApIHsgLyogdGhpcyBzaG91bGQgbm90IGhhcHBlbiAqLyB0aHJvdyBuZXcgRXJyb3IoJ2VpZzogaW50ZXJuYWwgZXJyb3InKTsgfVxuICAgIHJldHVybiBudW1lcmljLmRpdih2LGZvbyk7XG59XG5cbm51bWVyaWMudG9VcHBlckhlc3NlbmJlcmcgPSBmdW5jdGlvbiB0b1VwcGVySGVzc2VuYmVyZyhtZSkge1xuICAgIHZhciBzID0gbnVtZXJpYy5kaW0obWUpO1xuICAgIGlmKHMubGVuZ3RoICE9PSAyIHx8IHNbMF0gIT09IHNbMV0pIHsgdGhyb3cgbmV3IEVycm9yKCdudW1lcmljOiB0b1VwcGVySGVzc2VuYmVyZygpIG9ubHkgd29ya3Mgb24gc3F1YXJlIG1hdHJpY2VzJyk7IH1cbiAgICB2YXIgbSA9IHNbMF0sIGksaixrLHgsdixBID0gbnVtZXJpYy5jbG9uZShtZSksQixDLEFpLENpLFEgPSBudW1lcmljLmlkZW50aXR5KG0pLFFpO1xuICAgIGZvcihqPTA7ajxtLTI7aisrKSB7XG4gICAgICAgIHggPSBBcnJheShtLWotMSk7XG4gICAgICAgIGZvcihpPWorMTtpPG07aSsrKSB7IHhbaS1qLTFdID0gQVtpXVtqXTsgfVxuICAgICAgICBpZihudW1lcmljLm5vcm0yKHgpPjApIHtcbiAgICAgICAgICAgIHYgPSBudW1lcmljLmhvdXNlKHgpO1xuICAgICAgICAgICAgQiA9IG51bWVyaWMuZ2V0QmxvY2soQSxbaisxLGpdLFttLTEsbS0xXSk7XG4gICAgICAgICAgICBDID0gbnVtZXJpYy50ZW5zb3IodixudW1lcmljLmRvdCh2LEIpKTtcbiAgICAgICAgICAgIGZvcihpPWorMTtpPG07aSsrKSB7IEFpID0gQVtpXTsgQ2kgPSBDW2ktai0xXTsgZm9yKGs9ajtrPG07aysrKSBBaVtrXSAtPSAyKkNpW2stal07IH1cbiAgICAgICAgICAgIEIgPSBudW1lcmljLmdldEJsb2NrKEEsWzAsaisxXSxbbS0xLG0tMV0pO1xuICAgICAgICAgICAgQyA9IG51bWVyaWMudGVuc29yKG51bWVyaWMuZG90KEIsdiksdik7XG4gICAgICAgICAgICBmb3IoaT0wO2k8bTtpKyspIHsgQWkgPSBBW2ldOyBDaSA9IENbaV07IGZvcihrPWorMTtrPG07aysrKSBBaVtrXSAtPSAyKkNpW2stai0xXTsgfVxuICAgICAgICAgICAgQiA9IEFycmF5KG0tai0xKTtcbiAgICAgICAgICAgIGZvcihpPWorMTtpPG07aSsrKSBCW2ktai0xXSA9IFFbaV07XG4gICAgICAgICAgICBDID0gbnVtZXJpYy50ZW5zb3IodixudW1lcmljLmRvdCh2LEIpKTtcbiAgICAgICAgICAgIGZvcihpPWorMTtpPG07aSsrKSB7IFFpID0gUVtpXTsgQ2kgPSBDW2ktai0xXTsgZm9yKGs9MDtrPG07aysrKSBRaVtrXSAtPSAyKkNpW2tdOyB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtIOkEsIFE6UX07XG59XG5cbm51bWVyaWMuZXBzaWxvbiA9IDIuMjIwNDQ2MDQ5MjUwMzEzZS0xNjtcblxubnVtZXJpYy5RUkZyYW5jaXMgPSBmdW5jdGlvbihILG1heGl0ZXIpIHtcbiAgICBpZih0eXBlb2YgbWF4aXRlciA9PT0gXCJ1bmRlZmluZWRcIikgeyBtYXhpdGVyID0gMTAwMDA7IH1cbiAgICBIID0gbnVtZXJpYy5jbG9uZShIKTtcbiAgICB2YXIgSDAgPSBudW1lcmljLmNsb25lKEgpO1xuICAgIHZhciBzID0gbnVtZXJpYy5kaW0oSCksbT1zWzBdLHgsdixhLGIsYyxkLGRldCx0ciwgSGxvYywgUSA9IG51bWVyaWMuaWRlbnRpdHkobSksIFFpLCBIaSwgQiwgQywgQ2ksaSxqLGssaXRlcjtcbiAgICBpZihtPDMpIHsgcmV0dXJuIHtROlEsIEI6WyBbMCxtLTFdIF19OyB9XG4gICAgdmFyIGVwc2lsb24gPSBudW1lcmljLmVwc2lsb247XG4gICAgZm9yKGl0ZXI9MDtpdGVyPG1heGl0ZXI7aXRlcisrKSB7XG4gICAgICAgIGZvcihqPTA7ajxtLTE7aisrKSB7XG4gICAgICAgICAgICBpZihNYXRoLmFicyhIW2orMV1bal0pIDwgZXBzaWxvbiooTWF0aC5hYnMoSFtqXVtqXSkrTWF0aC5hYnMoSFtqKzFdW2orMV0pKSkge1xuICAgICAgICAgICAgICAgIHZhciBRSDEgPSBudW1lcmljLlFSRnJhbmNpcyhudW1lcmljLmdldEJsb2NrKEgsWzAsMF0sW2osal0pLG1heGl0ZXIpO1xuICAgICAgICAgICAgICAgIHZhciBRSDIgPSBudW1lcmljLlFSRnJhbmNpcyhudW1lcmljLmdldEJsb2NrKEgsW2orMSxqKzFdLFttLTEsbS0xXSksbWF4aXRlcik7XG4gICAgICAgICAgICAgICAgQiA9IEFycmF5KGorMSk7XG4gICAgICAgICAgICAgICAgZm9yKGk9MDtpPD1qO2krKykgeyBCW2ldID0gUVtpXTsgfVxuICAgICAgICAgICAgICAgIEMgPSBudW1lcmljLmRvdChRSDEuUSxCKTtcbiAgICAgICAgICAgICAgICBmb3IoaT0wO2k8PWo7aSsrKSB7IFFbaV0gPSBDW2ldOyB9XG4gICAgICAgICAgICAgICAgQiA9IEFycmF5KG0tai0xKTtcbiAgICAgICAgICAgICAgICBmb3IoaT1qKzE7aTxtO2krKykgeyBCW2ktai0xXSA9IFFbaV07IH1cbiAgICAgICAgICAgICAgICBDID0gbnVtZXJpYy5kb3QoUUgyLlEsQik7XG4gICAgICAgICAgICAgICAgZm9yKGk9aisxO2k8bTtpKyspIHsgUVtpXSA9IENbaS1qLTFdOyB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtROlEsQjpRSDEuQi5jb25jYXQobnVtZXJpYy5hZGQoUUgyLkIsaisxKSl9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGEgPSBIW20tMl1bbS0yXTsgYiA9IEhbbS0yXVttLTFdO1xuICAgICAgICBjID0gSFttLTFdW20tMl07IGQgPSBIW20tMV1bbS0xXTtcbiAgICAgICAgdHIgPSBhK2Q7XG4gICAgICAgIGRldCA9IChhKmQtYipjKTtcbiAgICAgICAgSGxvYyA9IG51bWVyaWMuZ2V0QmxvY2soSCwgWzAsMF0sIFsyLDJdKTtcbiAgICAgICAgaWYodHIqdHI+PTQqZGV0KSB7XG4gICAgICAgICAgICB2YXIgczEsczI7XG4gICAgICAgICAgICBzMSA9IDAuNSoodHIrTWF0aC5zcXJ0KHRyKnRyLTQqZGV0KSk7XG4gICAgICAgICAgICBzMiA9IDAuNSoodHItTWF0aC5zcXJ0KHRyKnRyLTQqZGV0KSk7XG4gICAgICAgICAgICBIbG9jID0gbnVtZXJpYy5hZGQobnVtZXJpYy5zdWIobnVtZXJpYy5kb3QoSGxvYyxIbG9jKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudW1lcmljLm11bChIbG9jLHMxK3MyKSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbnVtZXJpYy5kaWFnKG51bWVyaWMucmVwKFszXSxzMSpzMikpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEhsb2MgPSBudW1lcmljLmFkZChudW1lcmljLnN1YihudW1lcmljLmRvdChIbG9jLEhsb2MpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG51bWVyaWMubXVsKEhsb2MsdHIpKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudW1lcmljLmRpYWcobnVtZXJpYy5yZXAoWzNdLGRldCkpKTtcbiAgICAgICAgfVxuICAgICAgICB4ID0gW0hsb2NbMF1bMF0sSGxvY1sxXVswXSxIbG9jWzJdWzBdXTtcbiAgICAgICAgdiA9IG51bWVyaWMuaG91c2UoeCk7XG4gICAgICAgIEIgPSBbSFswXSxIWzFdLEhbMl1dO1xuICAgICAgICBDID0gbnVtZXJpYy50ZW5zb3IodixudW1lcmljLmRvdCh2LEIpKTtcbiAgICAgICAgZm9yKGk9MDtpPDM7aSsrKSB7IEhpID0gSFtpXTsgQ2kgPSBDW2ldOyBmb3Ioaz0wO2s8bTtrKyspIEhpW2tdIC09IDIqQ2lba107IH1cbiAgICAgICAgQiA9IG51bWVyaWMuZ2V0QmxvY2soSCwgWzAsMF0sW20tMSwyXSk7XG4gICAgICAgIEMgPSBudW1lcmljLnRlbnNvcihudW1lcmljLmRvdChCLHYpLHYpO1xuICAgICAgICBmb3IoaT0wO2k8bTtpKyspIHsgSGkgPSBIW2ldOyBDaSA9IENbaV07IGZvcihrPTA7azwzO2srKykgSGlba10gLT0gMipDaVtrXTsgfVxuICAgICAgICBCID0gW1FbMF0sUVsxXSxRWzJdXTtcbiAgICAgICAgQyA9IG51bWVyaWMudGVuc29yKHYsbnVtZXJpYy5kb3QodixCKSk7XG4gICAgICAgIGZvcihpPTA7aTwzO2krKykgeyBRaSA9IFFbaV07IENpID0gQ1tpXTsgZm9yKGs9MDtrPG07aysrKSBRaVtrXSAtPSAyKkNpW2tdOyB9XG4gICAgICAgIHZhciBKO1xuICAgICAgICBmb3Ioaj0wO2o8bS0yO2orKykge1xuICAgICAgICAgICAgZm9yKGs9ajtrPD1qKzE7aysrKSB7XG4gICAgICAgICAgICAgICAgaWYoTWF0aC5hYnMoSFtrKzFdW2tdKSA8IGVwc2lsb24qKE1hdGguYWJzKEhba11ba10pK01hdGguYWJzKEhbaysxXVtrKzFdKSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIFFIMSA9IG51bWVyaWMuUVJGcmFuY2lzKG51bWVyaWMuZ2V0QmxvY2soSCxbMCwwXSxbayxrXSksbWF4aXRlcik7XG4gICAgICAgICAgICAgICAgICAgIHZhciBRSDIgPSBudW1lcmljLlFSRnJhbmNpcyhudW1lcmljLmdldEJsb2NrKEgsW2srMSxrKzFdLFttLTEsbS0xXSksbWF4aXRlcik7XG4gICAgICAgICAgICAgICAgICAgIEIgPSBBcnJheShrKzEpO1xuICAgICAgICAgICAgICAgICAgICBmb3IoaT0wO2k8PWs7aSsrKSB7IEJbaV0gPSBRW2ldOyB9XG4gICAgICAgICAgICAgICAgICAgIEMgPSBudW1lcmljLmRvdChRSDEuUSxCKTtcbiAgICAgICAgICAgICAgICAgICAgZm9yKGk9MDtpPD1rO2krKykgeyBRW2ldID0gQ1tpXTsgfVxuICAgICAgICAgICAgICAgICAgICBCID0gQXJyYXkobS1rLTEpO1xuICAgICAgICAgICAgICAgICAgICBmb3IoaT1rKzE7aTxtO2krKykgeyBCW2ktay0xXSA9IFFbaV07IH1cbiAgICAgICAgICAgICAgICAgICAgQyA9IG51bWVyaWMuZG90KFFIMi5RLEIpO1xuICAgICAgICAgICAgICAgICAgICBmb3IoaT1rKzE7aTxtO2krKykgeyBRW2ldID0gQ1tpLWstMV07IH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtROlEsQjpRSDEuQi5jb25jYXQobnVtZXJpYy5hZGQoUUgyLkIsaysxKSl9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIEogPSBNYXRoLm1pbihtLTEsaiszKTtcbiAgICAgICAgICAgIHggPSBBcnJheShKLWopO1xuICAgICAgICAgICAgZm9yKGk9aisxO2k8PUo7aSsrKSB7IHhbaS1qLTFdID0gSFtpXVtqXTsgfVxuICAgICAgICAgICAgdiA9IG51bWVyaWMuaG91c2UoeCk7XG4gICAgICAgICAgICBCID0gbnVtZXJpYy5nZXRCbG9jayhILCBbaisxLGpdLFtKLG0tMV0pO1xuICAgICAgICAgICAgQyA9IG51bWVyaWMudGVuc29yKHYsbnVtZXJpYy5kb3QodixCKSk7XG4gICAgICAgICAgICBmb3IoaT1qKzE7aTw9SjtpKyspIHsgSGkgPSBIW2ldOyBDaSA9IENbaS1qLTFdOyBmb3Ioaz1qO2s8bTtrKyspIEhpW2tdIC09IDIqQ2lbay1qXTsgfVxuICAgICAgICAgICAgQiA9IG51bWVyaWMuZ2V0QmxvY2soSCwgWzAsaisxXSxbbS0xLEpdKTtcbiAgICAgICAgICAgIEMgPSBudW1lcmljLnRlbnNvcihudW1lcmljLmRvdChCLHYpLHYpO1xuICAgICAgICAgICAgZm9yKGk9MDtpPG07aSsrKSB7IEhpID0gSFtpXTsgQ2kgPSBDW2ldOyBmb3Ioaz1qKzE7azw9SjtrKyspIEhpW2tdIC09IDIqQ2lbay1qLTFdOyB9XG4gICAgICAgICAgICBCID0gQXJyYXkoSi1qKTtcbiAgICAgICAgICAgIGZvcihpPWorMTtpPD1KO2krKykgQltpLWotMV0gPSBRW2ldO1xuICAgICAgICAgICAgQyA9IG51bWVyaWMudGVuc29yKHYsbnVtZXJpYy5kb3QodixCKSk7XG4gICAgICAgICAgICBmb3IoaT1qKzE7aTw9SjtpKyspIHsgUWkgPSBRW2ldOyBDaSA9IENbaS1qLTFdOyBmb3Ioaz0wO2s8bTtrKyspIFFpW2tdIC09IDIqQ2lba107IH1cbiAgICAgICAgfVxuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoJ251bWVyaWM6IGVpZ2VudmFsdWUgaXRlcmF0aW9uIGRvZXMgbm90IGNvbnZlcmdlIC0tIGluY3JlYXNlIG1heGl0ZXI/Jyk7XG59XG5cbm51bWVyaWMuZWlnID0gZnVuY3Rpb24gZWlnKEEsbWF4aXRlcikge1xuICAgIHZhciBRSCA9IG51bWVyaWMudG9VcHBlckhlc3NlbmJlcmcoQSk7XG4gICAgdmFyIFFCID0gbnVtZXJpYy5RUkZyYW5jaXMoUUguSCxtYXhpdGVyKTtcbiAgICB2YXIgVCA9IG51bWVyaWMuVDtcbiAgICB2YXIgbiA9IEEubGVuZ3RoLGksayxmbGFnID0gZmFsc2UsQiA9IFFCLkIsSCA9IG51bWVyaWMuZG90KFFCLlEsbnVtZXJpYy5kb3QoUUguSCxudW1lcmljLnRyYW5zcG9zZShRQi5RKSkpO1xuICAgIHZhciBRID0gbmV3IFQobnVtZXJpYy5kb3QoUUIuUSxRSC5RKSksUTA7XG4gICAgdmFyIG0gPSBCLmxlbmd0aCxqO1xuICAgIHZhciBhLGIsYyxkLHAxLHAyLGRpc2MseCx5LHAscSxuMSxuMjtcbiAgICB2YXIgc3FydCA9IE1hdGguc3FydDtcbiAgICBmb3Ioaz0wO2s8bTtrKyspIHtcbiAgICAgICAgaSA9IEJba11bMF07XG4gICAgICAgIGlmKGkgPT09IEJba11bMV0pIHtcbiAgICAgICAgICAgIC8vIG5vdGhpbmdcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGogPSBpKzE7XG4gICAgICAgICAgICBhID0gSFtpXVtpXTtcbiAgICAgICAgICAgIGIgPSBIW2ldW2pdO1xuICAgICAgICAgICAgYyA9IEhbal1baV07XG4gICAgICAgICAgICBkID0gSFtqXVtqXTtcbiAgICAgICAgICAgIGlmKGIgPT09IDAgJiYgYyA9PT0gMCkgY29udGludWU7XG4gICAgICAgICAgICBwMSA9IC1hLWQ7XG4gICAgICAgICAgICBwMiA9IGEqZC1iKmM7XG4gICAgICAgICAgICBkaXNjID0gcDEqcDEtNCpwMjtcbiAgICAgICAgICAgIGlmKGRpc2M+PTApIHtcbiAgICAgICAgICAgICAgICBpZihwMTwwKSB4ID0gLTAuNSoocDEtc3FydChkaXNjKSk7XG4gICAgICAgICAgICAgICAgZWxzZSAgICAgeCA9IC0wLjUqKHAxK3NxcnQoZGlzYykpO1xuICAgICAgICAgICAgICAgIG4xID0gKGEteCkqKGEteCkrYipiO1xuICAgICAgICAgICAgICAgIG4yID0gYypjKyhkLXgpKihkLXgpO1xuICAgICAgICAgICAgICAgIGlmKG4xPm4yKSB7XG4gICAgICAgICAgICAgICAgICAgIG4xID0gc3FydChuMSk7XG4gICAgICAgICAgICAgICAgICAgIHAgPSAoYS14KS9uMTtcbiAgICAgICAgICAgICAgICAgICAgcSA9IGIvbjE7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbjIgPSBzcXJ0KG4yKTtcbiAgICAgICAgICAgICAgICAgICAgcCA9IGMvbjI7XG4gICAgICAgICAgICAgICAgICAgIHEgPSAoZC14KS9uMjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgUTAgPSBuZXcgVChbW3EsLXBdLFtwLHFdXSk7XG4gICAgICAgICAgICAgICAgUS5zZXRSb3dzKGksaixRMC5kb3QoUS5nZXRSb3dzKGksaikpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgeCA9IC0wLjUqcDE7XG4gICAgICAgICAgICAgICAgeSA9IDAuNSpzcXJ0KC1kaXNjKTtcbiAgICAgICAgICAgICAgICBuMSA9IChhLXgpKihhLXgpK2IqYjtcbiAgICAgICAgICAgICAgICBuMiA9IGMqYysoZC14KSooZC14KTtcbiAgICAgICAgICAgICAgICBpZihuMT5uMikge1xuICAgICAgICAgICAgICAgICAgICBuMSA9IHNxcnQobjEreSp5KTtcbiAgICAgICAgICAgICAgICAgICAgcCA9IChhLXgpL24xO1xuICAgICAgICAgICAgICAgICAgICBxID0gYi9uMTtcbiAgICAgICAgICAgICAgICAgICAgeCA9IDA7XG4gICAgICAgICAgICAgICAgICAgIHkgLz0gbjE7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbjIgPSBzcXJ0KG4yK3kqeSk7XG4gICAgICAgICAgICAgICAgICAgIHAgPSBjL24yO1xuICAgICAgICAgICAgICAgICAgICBxID0gKGQteCkvbjI7XG4gICAgICAgICAgICAgICAgICAgIHggPSB5L24yO1xuICAgICAgICAgICAgICAgICAgICB5ID0gMDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgUTAgPSBuZXcgVChbW3EsLXBdLFtwLHFdXSxbW3gseV0sW3ksLXhdXSk7XG4gICAgICAgICAgICAgICAgUS5zZXRSb3dzKGksaixRMC5kb3QoUS5nZXRSb3dzKGksaikpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICB2YXIgUiA9IFEuZG90KEEpLmRvdChRLnRyYW5zanVnYXRlKCkpLCBuID0gQS5sZW5ndGgsIEUgPSBudW1lcmljLlQuaWRlbnRpdHkobik7XG4gICAgZm9yKGo9MDtqPG47aisrKSB7XG4gICAgICAgIGlmKGo+MCkge1xuICAgICAgICAgICAgZm9yKGs9ai0xO2s+PTA7ay0tKSB7XG4gICAgICAgICAgICAgICAgdmFyIFJrID0gUi5nZXQoW2ssa10pLCBSaiA9IFIuZ2V0KFtqLGpdKTtcbiAgICAgICAgICAgICAgICBpZihudW1lcmljLm5lcShSay54LFJqLngpIHx8IG51bWVyaWMubmVxKFJrLnksUmoueSkpIHtcbiAgICAgICAgICAgICAgICAgICAgeCA9IFIuZ2V0Um93KGspLmdldEJsb2NrKFtrXSxbai0xXSk7XG4gICAgICAgICAgICAgICAgICAgIHkgPSBFLmdldFJvdyhqKS5nZXRCbG9jayhba10sW2otMV0pO1xuICAgICAgICAgICAgICAgICAgICBFLnNldChbaixrXSwoUi5nZXQoW2ssal0pLm5lZygpLnN1Yih4LmRvdCh5KSkpLmRpdihSay5zdWIoUmopKSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgRS5zZXRSb3coaixFLmdldFJvdyhrKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBmb3Ioaj0wO2o8bjtqKyspIHtcbiAgICAgICAgeCA9IEUuZ2V0Um93KGopO1xuICAgICAgICBFLnNldFJvdyhqLHguZGl2KHgubm9ybTIoKSkpO1xuICAgIH1cbiAgICBFID0gRS50cmFuc3Bvc2UoKTtcbiAgICBFID0gUS50cmFuc2p1Z2F0ZSgpLmRvdChFKTtcbiAgICByZXR1cm4geyBsYW1iZGE6Ui5nZXREaWFnKCksIEU6RSB9O1xufTtcblxuLy8gNS4gQ29tcHJlc3NlZCBDb2x1bW4gU3RvcmFnZSBtYXRyaWNlc1xubnVtZXJpYy5jY3NTcGFyc2UgPSBmdW5jdGlvbiBjY3NTcGFyc2UoQSkge1xuICAgIHZhciBtID0gQS5sZW5ndGgsbixmb28sIGksaiwgY291bnRzID0gW107XG4gICAgZm9yKGk9bS0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgZm9vID0gQVtpXTtcbiAgICAgICAgZm9yKGogaW4gZm9vKSB7XG4gICAgICAgICAgICBqID0gcGFyc2VJbnQoaik7XG4gICAgICAgICAgICB3aGlsZShqPj1jb3VudHMubGVuZ3RoKSBjb3VudHNbY291bnRzLmxlbmd0aF0gPSAwO1xuICAgICAgICAgICAgaWYoZm9vW2pdIT09MCkgY291bnRzW2pdKys7XG4gICAgICAgIH1cbiAgICB9XG4gICAgdmFyIG4gPSBjb3VudHMubGVuZ3RoO1xuICAgIHZhciBBaSA9IEFycmF5KG4rMSk7XG4gICAgQWlbMF0gPSAwO1xuICAgIGZvcihpPTA7aTxuOysraSkgQWlbaSsxXSA9IEFpW2ldICsgY291bnRzW2ldO1xuICAgIHZhciBBaiA9IEFycmF5KEFpW25dKSwgQXYgPSBBcnJheShBaVtuXSk7XG4gICAgZm9yKGk9bS0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgZm9vID0gQVtpXTtcbiAgICAgICAgZm9yKGogaW4gZm9vKSB7XG4gICAgICAgICAgICBpZihmb29bal0hPT0wKSB7XG4gICAgICAgICAgICAgICAgY291bnRzW2pdLS07XG4gICAgICAgICAgICAgICAgQWpbQWlbal0rY291bnRzW2pdXSA9IGk7XG4gICAgICAgICAgICAgICAgQXZbQWlbal0rY291bnRzW2pdXSA9IGZvb1tqXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gW0FpLEFqLEF2XTtcbn1cbm51bWVyaWMuY2NzRnVsbCA9IGZ1bmN0aW9uIGNjc0Z1bGwoQSkge1xuICAgIHZhciBBaSA9IEFbMF0sIEFqID0gQVsxXSwgQXYgPSBBWzJdLCBzID0gbnVtZXJpYy5jY3NEaW0oQSksIG0gPSBzWzBdLCBuID0gc1sxXSwgaSxqLGowLGoxLGs7XG4gICAgdmFyIEIgPSBudW1lcmljLnJlcChbbSxuXSwwKTtcbiAgICBmb3IoaT0wO2k8bjtpKyspIHtcbiAgICAgICAgajAgPSBBaVtpXTtcbiAgICAgICAgajEgPSBBaVtpKzFdO1xuICAgICAgICBmb3Ioaj1qMDtqPGoxOysraikgeyBCW0FqW2pdXVtpXSA9IEF2W2pdOyB9XG4gICAgfVxuICAgIHJldHVybiBCO1xufVxubnVtZXJpYy5jY3NUU29sdmUgPSBmdW5jdGlvbiBjY3NUU29sdmUoQSxiLHgsYmoseGopIHtcbiAgICB2YXIgQWkgPSBBWzBdLCBBaiA9IEFbMV0sIEF2ID0gQVsyXSxtID0gQWkubGVuZ3RoLTEsIG1heCA9IE1hdGgubWF4LG49MDtcbiAgICBpZih0eXBlb2YgYmogPT09IFwidW5kZWZpbmVkXCIpIHggPSBudW1lcmljLnJlcChbbV0sMCk7XG4gICAgaWYodHlwZW9mIGJqID09PSBcInVuZGVmaW5lZFwiKSBiaiA9IG51bWVyaWMubGluc3BhY2UoMCx4Lmxlbmd0aC0xKTtcbiAgICBpZih0eXBlb2YgeGogPT09IFwidW5kZWZpbmVkXCIpIHhqID0gW107XG4gICAgZnVuY3Rpb24gZGZzKGopIHtcbiAgICAgICAgdmFyIGs7XG4gICAgICAgIGlmKHhbal0gIT09IDApIHJldHVybjtcbiAgICAgICAgeFtqXSA9IDE7XG4gICAgICAgIGZvcihrPUFpW2pdO2s8QWlbaisxXTsrK2spIGRmcyhBaltrXSk7XG4gICAgICAgIHhqW25dID0gajtcbiAgICAgICAgKytuO1xuICAgIH1cbiAgICB2YXIgaSxqLGowLGoxLGssbCxsMCxsMSxhO1xuICAgIGZvcihpPWJqLmxlbmd0aC0xO2khPT0tMTstLWkpIHsgZGZzKGJqW2ldKTsgfVxuICAgIHhqLmxlbmd0aCA9IG47XG4gICAgZm9yKGk9eGoubGVuZ3RoLTE7aSE9PS0xOy0taSkgeyB4W3hqW2ldXSA9IDA7IH1cbiAgICBmb3IoaT1iai5sZW5ndGgtMTtpIT09LTE7LS1pKSB7IGogPSBialtpXTsgeFtqXSA9IGJbal07IH1cbiAgICBmb3IoaT14ai5sZW5ndGgtMTtpIT09LTE7LS1pKSB7XG4gICAgICAgIGogPSB4altpXTtcbiAgICAgICAgajAgPSBBaVtqXTtcbiAgICAgICAgajEgPSBtYXgoQWlbaisxXSxqMCk7XG4gICAgICAgIGZvcihrPWowO2shPT1qMTsrK2spIHsgaWYoQWpba10gPT09IGopIHsgeFtqXSAvPSBBdltrXTsgYnJlYWs7IH0gfVxuICAgICAgICBhID0geFtqXTtcbiAgICAgICAgZm9yKGs9ajA7ayE9PWoxOysraykge1xuICAgICAgICAgICAgbCA9IEFqW2tdO1xuICAgICAgICAgICAgaWYobCAhPT0gaikgeFtsXSAtPSBhKkF2W2tdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB4O1xufVxubnVtZXJpYy5jY3NERlMgPSBmdW5jdGlvbiBjY3NERlMobikge1xuICAgIHRoaXMuayA9IEFycmF5KG4pO1xuICAgIHRoaXMuazEgPSBBcnJheShuKTtcbiAgICB0aGlzLmogPSBBcnJheShuKTtcbn1cbm51bWVyaWMuY2NzREZTLnByb3RvdHlwZS5kZnMgPSBmdW5jdGlvbiBkZnMoSixBaSxBaix4LHhqLFBpbnYpIHtcbiAgICB2YXIgbSA9IDAsZm9vLG49eGoubGVuZ3RoO1xuICAgIHZhciBrID0gdGhpcy5rLCBrMSA9IHRoaXMuazEsIGogPSB0aGlzLmosa20sazExO1xuICAgIGlmKHhbSl0hPT0wKSByZXR1cm47XG4gICAgeFtKXSA9IDE7XG4gICAgalswXSA9IEo7XG4gICAga1swXSA9IGttID0gQWlbSl07XG4gICAgazFbMF0gPSBrMTEgPSBBaVtKKzFdO1xuICAgIHdoaWxlKDEpIHtcbiAgICAgICAgaWYoa20gPj0gazExKSB7XG4gICAgICAgICAgICB4altuXSA9IGpbbV07XG4gICAgICAgICAgICBpZihtPT09MCkgcmV0dXJuO1xuICAgICAgICAgICAgKytuO1xuICAgICAgICAgICAgLS1tO1xuICAgICAgICAgICAga20gPSBrW21dO1xuICAgICAgICAgICAgazExID0gazFbbV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb28gPSBQaW52W0FqW2ttXV07XG4gICAgICAgICAgICBpZih4W2Zvb10gPT09IDApIHtcbiAgICAgICAgICAgICAgICB4W2Zvb10gPSAxO1xuICAgICAgICAgICAgICAgIGtbbV0gPSBrbTtcbiAgICAgICAgICAgICAgICArK207XG4gICAgICAgICAgICAgICAgalttXSA9IGZvbztcbiAgICAgICAgICAgICAgICBrbSA9IEFpW2Zvb107XG4gICAgICAgICAgICAgICAgazFbbV0gPSBrMTEgPSBBaVtmb28rMV07XG4gICAgICAgICAgICB9IGVsc2UgKytrbTtcbiAgICAgICAgfVxuICAgIH1cbn1cbm51bWVyaWMuY2NzTFBTb2x2ZSA9IGZ1bmN0aW9uIGNjc0xQU29sdmUoQSxCLHgseGosSSxQaW52LGRmcykge1xuICAgIHZhciBBaSA9IEFbMF0sIEFqID0gQVsxXSwgQXYgPSBBWzJdLG0gPSBBaS5sZW5ndGgtMSwgbj0wO1xuICAgIHZhciBCaSA9IEJbMF0sIEJqID0gQlsxXSwgQnYgPSBCWzJdO1xuICAgIFxuICAgIHZhciBpLGkwLGkxLGosSixqMCxqMSxrLGwsbDAsbDEsYTtcbiAgICBpMCA9IEJpW0ldO1xuICAgIGkxID0gQmlbSSsxXTtcbiAgICB4ai5sZW5ndGggPSAwO1xuICAgIGZvcihpPWkwO2k8aTE7KytpKSB7IGRmcy5kZnMoUGludltCaltpXV0sQWksQWoseCx4aixQaW52KTsgfVxuICAgIGZvcihpPXhqLmxlbmd0aC0xO2khPT0tMTstLWkpIHsgeFt4altpXV0gPSAwOyB9XG4gICAgZm9yKGk9aTA7aSE9PWkxOysraSkgeyBqID0gUGludltCaltpXV07IHhbal0gPSBCdltpXTsgfVxuICAgIGZvcihpPXhqLmxlbmd0aC0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgaiA9IHhqW2ldO1xuICAgICAgICBqMCA9IEFpW2pdO1xuICAgICAgICBqMSA9IEFpW2orMV07XG4gICAgICAgIGZvcihrPWowO2s8ajE7KytrKSB7IGlmKFBpbnZbQWpba11dID09PSBqKSB7IHhbal0gLz0gQXZba107IGJyZWFrOyB9IH1cbiAgICAgICAgYSA9IHhbal07XG4gICAgICAgIGZvcihrPWowO2s8ajE7KytrKSB7XG4gICAgICAgICAgICBsID0gUGludltBaltrXV07XG4gICAgICAgICAgICBpZihsICE9PSBqKSB4W2xdIC09IGEqQXZba107XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHg7XG59XG5udW1lcmljLmNjc0xVUDEgPSBmdW5jdGlvbiBjY3NMVVAxKEEsdGhyZXNob2xkKSB7XG4gICAgdmFyIG0gPSBBWzBdLmxlbmd0aC0xO1xuICAgIHZhciBMID0gW251bWVyaWMucmVwKFttKzFdLDApLFtdLFtdXSwgVSA9IFtudW1lcmljLnJlcChbbSsxXSwgMCksW10sW11dO1xuICAgIHZhciBMaSA9IExbMF0sIExqID0gTFsxXSwgTHYgPSBMWzJdLCBVaSA9IFVbMF0sIFVqID0gVVsxXSwgVXYgPSBVWzJdO1xuICAgIHZhciB4ID0gbnVtZXJpYy5yZXAoW21dLDApLCB4aiA9IG51bWVyaWMucmVwKFttXSwwKTtcbiAgICB2YXIgaSxqLGssajAsajEsYSxlLGMsZCxLO1xuICAgIHZhciBzb2wgPSBudW1lcmljLmNjc0xQU29sdmUsIG1heCA9IE1hdGgubWF4LCBhYnMgPSBNYXRoLmFicztcbiAgICB2YXIgUCA9IG51bWVyaWMubGluc3BhY2UoMCxtLTEpLFBpbnYgPSBudW1lcmljLmxpbnNwYWNlKDAsbS0xKTtcbiAgICB2YXIgZGZzID0gbmV3IG51bWVyaWMuY2NzREZTKG0pO1xuICAgIGlmKHR5cGVvZiB0aHJlc2hvbGQgPT09IFwidW5kZWZpbmVkXCIpIHsgdGhyZXNob2xkID0gMTsgfVxuICAgIGZvcihpPTA7aTxtOysraSkge1xuICAgICAgICBzb2woTCxBLHgseGosaSxQaW52LGRmcyk7XG4gICAgICAgIGEgPSAtMTtcbiAgICAgICAgZSA9IC0xO1xuICAgICAgICBmb3Ioaj14ai5sZW5ndGgtMTtqIT09LTE7LS1qKSB7XG4gICAgICAgICAgICBrID0geGpbal07XG4gICAgICAgICAgICBpZihrIDw9IGkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgYyA9IGFicyh4W2tdKTtcbiAgICAgICAgICAgIGlmKGMgPiBhKSB7IGUgPSBrOyBhID0gYzsgfVxuICAgICAgICB9XG4gICAgICAgIGlmKGFicyh4W2ldKTx0aHJlc2hvbGQqYSkge1xuICAgICAgICAgICAgaiA9IFBbaV07XG4gICAgICAgICAgICBhID0gUFtlXTtcbiAgICAgICAgICAgIFBbaV0gPSBhOyBQaW52W2FdID0gaTtcbiAgICAgICAgICAgIFBbZV0gPSBqOyBQaW52W2pdID0gZTtcbiAgICAgICAgICAgIGEgPSB4W2ldOyB4W2ldID0geFtlXTsgeFtlXSA9IGE7XG4gICAgICAgIH1cbiAgICAgICAgYSA9IExpW2ldO1xuICAgICAgICBlID0gVWlbaV07XG4gICAgICAgIGQgPSB4W2ldO1xuICAgICAgICBMalthXSA9IFBbaV07XG4gICAgICAgIEx2W2FdID0gMTtcbiAgICAgICAgKythO1xuICAgICAgICBmb3Ioaj14ai5sZW5ndGgtMTtqIT09LTE7LS1qKSB7XG4gICAgICAgICAgICBrID0geGpbal07XG4gICAgICAgICAgICBjID0geFtrXTtcbiAgICAgICAgICAgIHhqW2pdID0gMDtcbiAgICAgICAgICAgIHhba10gPSAwO1xuICAgICAgICAgICAgaWYoazw9aSkgeyBValtlXSA9IGs7IFV2W2VdID0gYzsgICArK2U7IH1cbiAgICAgICAgICAgIGVsc2UgICAgIHsgTGpbYV0gPSBQW2tdOyBMdlthXSA9IGMvZDsgKythOyB9XG4gICAgICAgIH1cbiAgICAgICAgTGlbaSsxXSA9IGE7XG4gICAgICAgIFVpW2krMV0gPSBlO1xuICAgIH1cbiAgICBmb3Ioaj1Mai5sZW5ndGgtMTtqIT09LTE7LS1qKSB7IExqW2pdID0gUGludltMaltqXV07IH1cbiAgICByZXR1cm4ge0w6TCwgVTpVLCBQOlAsIFBpbnY6UGludn07XG59XG5udW1lcmljLmNjc0RGUzAgPSBmdW5jdGlvbiBjY3NERlMwKG4pIHtcbiAgICB0aGlzLmsgPSBBcnJheShuKTtcbiAgICB0aGlzLmsxID0gQXJyYXkobik7XG4gICAgdGhpcy5qID0gQXJyYXkobik7XG59XG5udW1lcmljLmNjc0RGUzAucHJvdG90eXBlLmRmcyA9IGZ1bmN0aW9uIGRmcyhKLEFpLEFqLHgseGosUGludixQKSB7XG4gICAgdmFyIG0gPSAwLGZvbyxuPXhqLmxlbmd0aDtcbiAgICB2YXIgayA9IHRoaXMuaywgazEgPSB0aGlzLmsxLCBqID0gdGhpcy5qLGttLGsxMTtcbiAgICBpZih4W0pdIT09MCkgcmV0dXJuO1xuICAgIHhbSl0gPSAxO1xuICAgIGpbMF0gPSBKO1xuICAgIGtbMF0gPSBrbSA9IEFpW1BpbnZbSl1dO1xuICAgIGsxWzBdID0gazExID0gQWlbUGludltKXSsxXTtcbiAgICB3aGlsZSgxKSB7XG4gICAgICAgIGlmKGlzTmFOKGttKSkgdGhyb3cgbmV3IEVycm9yKFwiT3chXCIpO1xuICAgICAgICBpZihrbSA+PSBrMTEpIHtcbiAgICAgICAgICAgIHhqW25dID0gUGludltqW21dXTtcbiAgICAgICAgICAgIGlmKG09PT0wKSByZXR1cm47XG4gICAgICAgICAgICArK247XG4gICAgICAgICAgICAtLW07XG4gICAgICAgICAgICBrbSA9IGtbbV07XG4gICAgICAgICAgICBrMTEgPSBrMVttXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvbyA9IEFqW2ttXTtcbiAgICAgICAgICAgIGlmKHhbZm9vXSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHhbZm9vXSA9IDE7XG4gICAgICAgICAgICAgICAga1ttXSA9IGttO1xuICAgICAgICAgICAgICAgICsrbTtcbiAgICAgICAgICAgICAgICBqW21dID0gZm9vO1xuICAgICAgICAgICAgICAgIGZvbyA9IFBpbnZbZm9vXTtcbiAgICAgICAgICAgICAgICBrbSA9IEFpW2Zvb107XG4gICAgICAgICAgICAgICAgazFbbV0gPSBrMTEgPSBBaVtmb28rMV07XG4gICAgICAgICAgICB9IGVsc2UgKytrbTtcbiAgICAgICAgfVxuICAgIH1cbn1cbm51bWVyaWMuY2NzTFBTb2x2ZTAgPSBmdW5jdGlvbiBjY3NMUFNvbHZlMChBLEIseSx4aixJLFBpbnYsUCxkZnMpIHtcbiAgICB2YXIgQWkgPSBBWzBdLCBBaiA9IEFbMV0sIEF2ID0gQVsyXSxtID0gQWkubGVuZ3RoLTEsIG49MDtcbiAgICB2YXIgQmkgPSBCWzBdLCBCaiA9IEJbMV0sIEJ2ID0gQlsyXTtcbiAgICBcbiAgICB2YXIgaSxpMCxpMSxqLEosajAsajEsayxsLGwwLGwxLGE7XG4gICAgaTAgPSBCaVtJXTtcbiAgICBpMSA9IEJpW0krMV07XG4gICAgeGoubGVuZ3RoID0gMDtcbiAgICBmb3IoaT1pMDtpPGkxOysraSkgeyBkZnMuZGZzKEJqW2ldLEFpLEFqLHkseGosUGludixQKTsgfVxuICAgIGZvcihpPXhqLmxlbmd0aC0xO2khPT0tMTstLWkpIHsgaiA9IHhqW2ldOyB5W1Bbal1dID0gMDsgfVxuICAgIGZvcihpPWkwO2khPT1pMTsrK2kpIHsgaiA9IEJqW2ldOyB5W2pdID0gQnZbaV07IH1cbiAgICBmb3IoaT14ai5sZW5ndGgtMTtpIT09LTE7LS1pKSB7XG4gICAgICAgIGogPSB4altpXTtcbiAgICAgICAgbCA9IFBbal07XG4gICAgICAgIGowID0gQWlbal07XG4gICAgICAgIGoxID0gQWlbaisxXTtcbiAgICAgICAgZm9yKGs9ajA7azxqMTsrK2spIHsgaWYoQWpba10gPT09IGwpIHsgeVtsXSAvPSBBdltrXTsgYnJlYWs7IH0gfVxuICAgICAgICBhID0geVtsXTtcbiAgICAgICAgZm9yKGs9ajA7azxqMTsrK2spIHlbQWpba11dIC09IGEqQXZba107XG4gICAgICAgIHlbbF0gPSBhO1xuICAgIH1cbn1cbm51bWVyaWMuY2NzTFVQMCA9IGZ1bmN0aW9uIGNjc0xVUDAoQSx0aHJlc2hvbGQpIHtcbiAgICB2YXIgbSA9IEFbMF0ubGVuZ3RoLTE7XG4gICAgdmFyIEwgPSBbbnVtZXJpYy5yZXAoW20rMV0sMCksW10sW11dLCBVID0gW251bWVyaWMucmVwKFttKzFdLCAwKSxbXSxbXV07XG4gICAgdmFyIExpID0gTFswXSwgTGogPSBMWzFdLCBMdiA9IExbMl0sIFVpID0gVVswXSwgVWogPSBVWzFdLCBVdiA9IFVbMl07XG4gICAgdmFyIHkgPSBudW1lcmljLnJlcChbbV0sMCksIHhqID0gbnVtZXJpYy5yZXAoW21dLDApO1xuICAgIHZhciBpLGosayxqMCxqMSxhLGUsYyxkLEs7XG4gICAgdmFyIHNvbCA9IG51bWVyaWMuY2NzTFBTb2x2ZTAsIG1heCA9IE1hdGgubWF4LCBhYnMgPSBNYXRoLmFicztcbiAgICB2YXIgUCA9IG51bWVyaWMubGluc3BhY2UoMCxtLTEpLFBpbnYgPSBudW1lcmljLmxpbnNwYWNlKDAsbS0xKTtcbiAgICB2YXIgZGZzID0gbmV3IG51bWVyaWMuY2NzREZTMChtKTtcbiAgICBpZih0eXBlb2YgdGhyZXNob2xkID09PSBcInVuZGVmaW5lZFwiKSB7IHRocmVzaG9sZCA9IDE7IH1cbiAgICBmb3IoaT0wO2k8bTsrK2kpIHtcbiAgICAgICAgc29sKEwsQSx5LHhqLGksUGludixQLGRmcyk7XG4gICAgICAgIGEgPSAtMTtcbiAgICAgICAgZSA9IC0xO1xuICAgICAgICBmb3Ioaj14ai5sZW5ndGgtMTtqIT09LTE7LS1qKSB7XG4gICAgICAgICAgICBrID0geGpbal07XG4gICAgICAgICAgICBpZihrIDw9IGkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgYyA9IGFicyh5W1Bba11dKTtcbiAgICAgICAgICAgIGlmKGMgPiBhKSB7IGUgPSBrOyBhID0gYzsgfVxuICAgICAgICB9XG4gICAgICAgIGlmKGFicyh5W1BbaV1dKTx0aHJlc2hvbGQqYSkge1xuICAgICAgICAgICAgaiA9IFBbaV07XG4gICAgICAgICAgICBhID0gUFtlXTtcbiAgICAgICAgICAgIFBbaV0gPSBhOyBQaW52W2FdID0gaTtcbiAgICAgICAgICAgIFBbZV0gPSBqOyBQaW52W2pdID0gZTtcbiAgICAgICAgfVxuICAgICAgICBhID0gTGlbaV07XG4gICAgICAgIGUgPSBVaVtpXTtcbiAgICAgICAgZCA9IHlbUFtpXV07XG4gICAgICAgIExqW2FdID0gUFtpXTtcbiAgICAgICAgTHZbYV0gPSAxO1xuICAgICAgICArK2E7XG4gICAgICAgIGZvcihqPXhqLmxlbmd0aC0xO2ohPT0tMTstLWopIHtcbiAgICAgICAgICAgIGsgPSB4altqXTtcbiAgICAgICAgICAgIGMgPSB5W1Bba11dO1xuICAgICAgICAgICAgeGpbal0gPSAwO1xuICAgICAgICAgICAgeVtQW2tdXSA9IDA7XG4gICAgICAgICAgICBpZihrPD1pKSB7IFVqW2VdID0gazsgVXZbZV0gPSBjOyAgICsrZTsgfVxuICAgICAgICAgICAgZWxzZSAgICAgeyBMalthXSA9IFBba107IEx2W2FdID0gYy9kOyArK2E7IH1cbiAgICAgICAgfVxuICAgICAgICBMaVtpKzFdID0gYTtcbiAgICAgICAgVWlbaSsxXSA9IGU7XG4gICAgfVxuICAgIGZvcihqPUxqLmxlbmd0aC0xO2ohPT0tMTstLWopIHsgTGpbal0gPSBQaW52W0xqW2pdXTsgfVxuICAgIHJldHVybiB7TDpMLCBVOlUsIFA6UCwgUGludjpQaW52fTtcbn1cbm51bWVyaWMuY2NzTFVQID0gbnVtZXJpYy5jY3NMVVAwO1xuXG5udW1lcmljLmNjc0RpbSA9IGZ1bmN0aW9uIGNjc0RpbShBKSB7IHJldHVybiBbbnVtZXJpYy5zdXAoQVsxXSkrMSxBWzBdLmxlbmd0aC0xXTsgfVxubnVtZXJpYy5jY3NHZXRCbG9jayA9IGZ1bmN0aW9uIGNjc0dldEJsb2NrKEEsaSxqKSB7XG4gICAgdmFyIHMgPSBudW1lcmljLmNjc0RpbShBKSxtPXNbMF0sbj1zWzFdO1xuICAgIGlmKHR5cGVvZiBpID09PSBcInVuZGVmaW5lZFwiKSB7IGkgPSBudW1lcmljLmxpbnNwYWNlKDAsbS0xKTsgfVxuICAgIGVsc2UgaWYodHlwZW9mIGkgPT09IFwibnVtYmVyXCIpIHsgaSA9IFtpXTsgfVxuICAgIGlmKHR5cGVvZiBqID09PSBcInVuZGVmaW5lZFwiKSB7IGogPSBudW1lcmljLmxpbnNwYWNlKDAsbi0xKTsgfVxuICAgIGVsc2UgaWYodHlwZW9mIGogPT09IFwibnVtYmVyXCIpIHsgaiA9IFtqXTsgfVxuICAgIHZhciBwLHAwLHAxLFAgPSBpLmxlbmd0aCxxLFEgPSBqLmxlbmd0aCxyLGpxLGlwO1xuICAgIHZhciBCaSA9IG51bWVyaWMucmVwKFtuXSwwKSwgQmo9W10sIEJ2PVtdLCBCID0gW0JpLEJqLEJ2XTtcbiAgICB2YXIgQWkgPSBBWzBdLCBBaiA9IEFbMV0sIEF2ID0gQVsyXTtcbiAgICB2YXIgeCA9IG51bWVyaWMucmVwKFttXSwwKSxjb3VudD0wLGZsYWdzID0gbnVtZXJpYy5yZXAoW21dLDApO1xuICAgIGZvcihxPTA7cTxROysrcSkge1xuICAgICAgICBqcSA9IGpbcV07XG4gICAgICAgIHZhciBxMCA9IEFpW2pxXTtcbiAgICAgICAgdmFyIHExID0gQWlbanErMV07XG4gICAgICAgIGZvcihwPXEwO3A8cTE7KytwKSB7XG4gICAgICAgICAgICByID0gQWpbcF07XG4gICAgICAgICAgICBmbGFnc1tyXSA9IDE7XG4gICAgICAgICAgICB4W3JdID0gQXZbcF07XG4gICAgICAgIH1cbiAgICAgICAgZm9yKHA9MDtwPFA7KytwKSB7XG4gICAgICAgICAgICBpcCA9IGlbcF07XG4gICAgICAgICAgICBpZihmbGFnc1tpcF0pIHtcbiAgICAgICAgICAgICAgICBCaltjb3VudF0gPSBwO1xuICAgICAgICAgICAgICAgIEJ2W2NvdW50XSA9IHhbaVtwXV07XG4gICAgICAgICAgICAgICAgKytjb3VudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmb3IocD1xMDtwPHExOysrcCkge1xuICAgICAgICAgICAgciA9IEFqW3BdO1xuICAgICAgICAgICAgZmxhZ3Nbcl0gPSAwO1xuICAgICAgICB9XG4gICAgICAgIEJpW3ErMV0gPSBjb3VudDtcbiAgICB9XG4gICAgcmV0dXJuIEI7XG59XG5cbm51bWVyaWMuY2NzRG90ID0gZnVuY3Rpb24gY2NzRG90KEEsQikge1xuICAgIHZhciBBaSA9IEFbMF0sIEFqID0gQVsxXSwgQXYgPSBBWzJdO1xuICAgIHZhciBCaSA9IEJbMF0sIEJqID0gQlsxXSwgQnYgPSBCWzJdO1xuICAgIHZhciBzQSA9IG51bWVyaWMuY2NzRGltKEEpLCBzQiA9IG51bWVyaWMuY2NzRGltKEIpO1xuICAgIHZhciBtID0gc0FbMF0sIG4gPSBzQVsxXSwgbyA9IHNCWzFdO1xuICAgIHZhciB4ID0gbnVtZXJpYy5yZXAoW21dLDApLCBmbGFncyA9IG51bWVyaWMucmVwKFttXSwwKSwgeGogPSBBcnJheShtKTtcbiAgICB2YXIgQ2kgPSBudW1lcmljLnJlcChbb10sMCksIENqID0gW10sIEN2ID0gW10sIEMgPSBbQ2ksQ2osQ3ZdO1xuICAgIHZhciBpLGosayxqMCxqMSxpMCxpMSxsLHAsYSxiO1xuICAgIGZvcihrPTA7ayE9PW87KytrKSB7XG4gICAgICAgIGowID0gQmlba107XG4gICAgICAgIGoxID0gQmlbaysxXTtcbiAgICAgICAgcCA9IDA7XG4gICAgICAgIGZvcihqPWowO2o8ajE7KytqKSB7XG4gICAgICAgICAgICBhID0gQmpbal07XG4gICAgICAgICAgICBiID0gQnZbal07XG4gICAgICAgICAgICBpMCA9IEFpW2FdO1xuICAgICAgICAgICAgaTEgPSBBaVthKzFdO1xuICAgICAgICAgICAgZm9yKGk9aTA7aTxpMTsrK2kpIHtcbiAgICAgICAgICAgICAgICBsID0gQWpbaV07XG4gICAgICAgICAgICAgICAgaWYoZmxhZ3NbbF09PT0wKSB7XG4gICAgICAgICAgICAgICAgICAgIHhqW3BdID0gbDtcbiAgICAgICAgICAgICAgICAgICAgZmxhZ3NbbF0gPSAxO1xuICAgICAgICAgICAgICAgICAgICBwID0gcCsxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB4W2xdID0geFtsXSArIEF2W2ldKmI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgajAgPSBDaVtrXTtcbiAgICAgICAgajEgPSBqMCtwO1xuICAgICAgICBDaVtrKzFdID0gajE7XG4gICAgICAgIGZvcihqPXAtMTtqIT09LTE7LS1qKSB7XG4gICAgICAgICAgICBiID0gajArajtcbiAgICAgICAgICAgIGkgPSB4altqXTtcbiAgICAgICAgICAgIENqW2JdID0gaTtcbiAgICAgICAgICAgIEN2W2JdID0geFtpXTtcbiAgICAgICAgICAgIGZsYWdzW2ldID0gMDtcbiAgICAgICAgICAgIHhbaV0gPSAwO1xuICAgICAgICB9XG4gICAgICAgIENpW2srMV0gPSBDaVtrXStwO1xuICAgIH1cbiAgICByZXR1cm4gQztcbn1cblxubnVtZXJpYy5jY3NMVVBTb2x2ZSA9IGZ1bmN0aW9uIGNjc0xVUFNvbHZlKExVUCxCKSB7XG4gICAgdmFyIEwgPSBMVVAuTCwgVSA9IExVUC5VLCBQID0gTFVQLlA7XG4gICAgdmFyIEJpID0gQlswXTtcbiAgICB2YXIgZmxhZyA9IGZhbHNlO1xuICAgIGlmKHR5cGVvZiBCaSAhPT0gXCJvYmplY3RcIikgeyBCID0gW1swLEIubGVuZ3RoXSxudW1lcmljLmxpbnNwYWNlKDAsQi5sZW5ndGgtMSksQl07IEJpID0gQlswXTsgZmxhZyA9IHRydWU7IH1cbiAgICB2YXIgQmogPSBCWzFdLCBCdiA9IEJbMl07XG4gICAgdmFyIG4gPSBMWzBdLmxlbmd0aC0xLCBtID0gQmkubGVuZ3RoLTE7XG4gICAgdmFyIHggPSBudW1lcmljLnJlcChbbl0sMCksIHhqID0gQXJyYXkobik7XG4gICAgdmFyIGIgPSBudW1lcmljLnJlcChbbl0sMCksIGJqID0gQXJyYXkobik7XG4gICAgdmFyIFhpID0gbnVtZXJpYy5yZXAoW20rMV0sMCksIFhqID0gW10sIFh2ID0gW107XG4gICAgdmFyIHNvbCA9IG51bWVyaWMuY2NzVFNvbHZlO1xuICAgIHZhciBpLGosajAsajEsayxKLE49MDtcbiAgICBmb3IoaT0wO2k8bTsrK2kpIHtcbiAgICAgICAgayA9IDA7XG4gICAgICAgIGowID0gQmlbaV07XG4gICAgICAgIGoxID0gQmlbaSsxXTtcbiAgICAgICAgZm9yKGo9ajA7ajxqMTsrK2opIHsgXG4gICAgICAgICAgICBKID0gTFVQLlBpbnZbQmpbal1dO1xuICAgICAgICAgICAgYmpba10gPSBKO1xuICAgICAgICAgICAgYltKXSA9IEJ2W2pdO1xuICAgICAgICAgICAgKytrO1xuICAgICAgICB9XG4gICAgICAgIGJqLmxlbmd0aCA9IGs7XG4gICAgICAgIHNvbChMLGIseCxiaix4aik7XG4gICAgICAgIGZvcihqPWJqLmxlbmd0aC0xO2ohPT0tMTstLWopIGJbYmpbal1dID0gMDtcbiAgICAgICAgc29sKFUseCxiLHhqLGJqKTtcbiAgICAgICAgaWYoZmxhZykgcmV0dXJuIGI7XG4gICAgICAgIGZvcihqPXhqLmxlbmd0aC0xO2ohPT0tMTstLWopIHhbeGpbal1dID0gMDtcbiAgICAgICAgZm9yKGo9YmoubGVuZ3RoLTE7aiE9PS0xOy0taikge1xuICAgICAgICAgICAgSiA9IGJqW2pdO1xuICAgICAgICAgICAgWGpbTl0gPSBKO1xuICAgICAgICAgICAgWHZbTl0gPSBiW0pdO1xuICAgICAgICAgICAgYltKXSA9IDA7XG4gICAgICAgICAgICArK047XG4gICAgICAgIH1cbiAgICAgICAgWGlbaSsxXSA9IE47XG4gICAgfVxuICAgIHJldHVybiBbWGksWGosWHZdO1xufVxuXG5udW1lcmljLmNjc2Jpbm9wID0gZnVuY3Rpb24gY2NzYmlub3AoYm9keSxzZXR1cCkge1xuICAgIGlmKHR5cGVvZiBzZXR1cCA9PT0gXCJ1bmRlZmluZWRcIikgc2V0dXA9Jyc7XG4gICAgcmV0dXJuIEZ1bmN0aW9uKCdYJywnWScsXG4gICAgICAgICAgICAndmFyIFhpID0gWFswXSwgWGogPSBYWzFdLCBYdiA9IFhbMl07XFxuJytcbiAgICAgICAgICAgICd2YXIgWWkgPSBZWzBdLCBZaiA9IFlbMV0sIFl2ID0gWVsyXTtcXG4nK1xuICAgICAgICAgICAgJ3ZhciBuID0gWGkubGVuZ3RoLTEsbSA9IE1hdGgubWF4KG51bWVyaWMuc3VwKFhqKSxudW1lcmljLnN1cChZaikpKzE7XFxuJytcbiAgICAgICAgICAgICd2YXIgWmkgPSBudW1lcmljLnJlcChbbisxXSwwKSwgWmogPSBbXSwgWnYgPSBbXTtcXG4nK1xuICAgICAgICAgICAgJ3ZhciB4ID0gbnVtZXJpYy5yZXAoW21dLDApLHkgPSBudW1lcmljLnJlcChbbV0sMCk7XFxuJytcbiAgICAgICAgICAgICd2YXIgeGsseWssems7XFxuJytcbiAgICAgICAgICAgICd2YXIgaSxqLGowLGoxLGsscD0wO1xcbicrXG4gICAgICAgICAgICBzZXR1cCtcbiAgICAgICAgICAgICdmb3IoaT0wO2k8bjsrK2kpIHtcXG4nK1xuICAgICAgICAgICAgJyAgajAgPSBYaVtpXTsgajEgPSBYaVtpKzFdO1xcbicrXG4gICAgICAgICAgICAnICBmb3Ioaj1qMDtqIT09ajE7KytqKSB7XFxuJytcbiAgICAgICAgICAgICcgICAgayA9IFhqW2pdO1xcbicrXG4gICAgICAgICAgICAnICAgIHhba10gPSAxO1xcbicrXG4gICAgICAgICAgICAnICAgIFpqW3BdID0gaztcXG4nK1xuICAgICAgICAgICAgJyAgICArK3A7XFxuJytcbiAgICAgICAgICAgICcgIH1cXG4nK1xuICAgICAgICAgICAgJyAgajAgPSBZaVtpXTsgajEgPSBZaVtpKzFdO1xcbicrXG4gICAgICAgICAgICAnICBmb3Ioaj1qMDtqIT09ajE7KytqKSB7XFxuJytcbiAgICAgICAgICAgICcgICAgayA9IFlqW2pdO1xcbicrXG4gICAgICAgICAgICAnICAgIHlba10gPSBZdltqXTtcXG4nK1xuICAgICAgICAgICAgJyAgICBpZih4W2tdID09PSAwKSB7XFxuJytcbiAgICAgICAgICAgICcgICAgICBaaltwXSA9IGs7XFxuJytcbiAgICAgICAgICAgICcgICAgICArK3A7XFxuJytcbiAgICAgICAgICAgICcgICAgfVxcbicrXG4gICAgICAgICAgICAnICB9XFxuJytcbiAgICAgICAgICAgICcgIFppW2krMV0gPSBwO1xcbicrXG4gICAgICAgICAgICAnICBqMCA9IFhpW2ldOyBqMSA9IFhpW2krMV07XFxuJytcbiAgICAgICAgICAgICcgIGZvcihqPWowO2ohPT1qMTsrK2opIHhbWGpbal1dID0gWHZbal07XFxuJytcbiAgICAgICAgICAgICcgIGowID0gWmlbaV07IGoxID0gWmlbaSsxXTtcXG4nK1xuICAgICAgICAgICAgJyAgZm9yKGo9ajA7aiE9PWoxOysraikge1xcbicrXG4gICAgICAgICAgICAnICAgIGsgPSBaaltqXTtcXG4nK1xuICAgICAgICAgICAgJyAgICB4ayA9IHhba107XFxuJytcbiAgICAgICAgICAgICcgICAgeWsgPSB5W2tdO1xcbicrXG4gICAgICAgICAgICBib2R5KydcXG4nK1xuICAgICAgICAgICAgJyAgICBadltqXSA9IHprO1xcbicrXG4gICAgICAgICAgICAnICB9XFxuJytcbiAgICAgICAgICAgICcgIGowID0gWGlbaV07IGoxID0gWGlbaSsxXTtcXG4nK1xuICAgICAgICAgICAgJyAgZm9yKGo9ajA7aiE9PWoxOysraikgeFtYaltqXV0gPSAwO1xcbicrXG4gICAgICAgICAgICAnICBqMCA9IFlpW2ldOyBqMSA9IFlpW2krMV07XFxuJytcbiAgICAgICAgICAgICcgIGZvcihqPWowO2ohPT1qMTsrK2opIHlbWWpbal1dID0gMDtcXG4nK1xuICAgICAgICAgICAgJ31cXG4nK1xuICAgICAgICAgICAgJ3JldHVybiBbWmksWmosWnZdOydcbiAgICAgICAgICAgICk7XG59O1xuXG4oZnVuY3Rpb24oKSB7XG4gICAgdmFyIGssQSxCLEM7XG4gICAgZm9yKGsgaW4gbnVtZXJpYy5vcHMyKSB7XG4gICAgICAgIGlmKGlzRmluaXRlKGV2YWwoJzEnK251bWVyaWMub3BzMltrXSsnMCcpKSkgQSA9ICdbWVswXSxZWzFdLG51bWVyaWMuJytrKycoWCxZWzJdKV0nO1xuICAgICAgICBlbHNlIEEgPSAnTmFOJztcbiAgICAgICAgaWYoaXNGaW5pdGUoZXZhbCgnMCcrbnVtZXJpYy5vcHMyW2tdKycxJykpKSBCID0gJ1tYWzBdLFhbMV0sbnVtZXJpYy4nK2srJyhYWzJdLFkpXSc7XG4gICAgICAgIGVsc2UgQiA9ICdOYU4nO1xuICAgICAgICBpZihpc0Zpbml0ZShldmFsKCcxJytudW1lcmljLm9wczJba10rJzAnKSkgJiYgaXNGaW5pdGUoZXZhbCgnMCcrbnVtZXJpYy5vcHMyW2tdKycxJykpKSBDID0gJ251bWVyaWMuY2NzJytrKydNTShYLFkpJztcbiAgICAgICAgZWxzZSBDID0gJ05hTic7XG4gICAgICAgIG51bWVyaWNbJ2NjcycraysnTU0nXSA9IG51bWVyaWMuY2NzYmlub3AoJ3prID0geGsgJytudW1lcmljLm9wczJba10rJ3lrOycpO1xuICAgICAgICBudW1lcmljWydjY3MnK2tdID0gRnVuY3Rpb24oJ1gnLCdZJyxcbiAgICAgICAgICAgICAgICAnaWYodHlwZW9mIFggPT09IFwibnVtYmVyXCIpIHJldHVybiAnK0ErJztcXG4nK1xuICAgICAgICAgICAgICAgICdpZih0eXBlb2YgWSA9PT0gXCJudW1iZXJcIikgcmV0dXJuICcrQisnO1xcbicrXG4gICAgICAgICAgICAgICAgJ3JldHVybiAnK0MrJztcXG4nXG4gICAgICAgICAgICAgICAgKTtcbiAgICB9XG59KCkpO1xuXG5udW1lcmljLmNjc1NjYXR0ZXIgPSBmdW5jdGlvbiBjY3NTY2F0dGVyKEEpIHtcbiAgICB2YXIgQWkgPSBBWzBdLCBBaiA9IEFbMV0sIEF2ID0gQVsyXTtcbiAgICB2YXIgbiA9IG51bWVyaWMuc3VwKEFqKSsxLG09QWkubGVuZ3RoO1xuICAgIHZhciBSaSA9IG51bWVyaWMucmVwKFtuXSwwKSxSaj1BcnJheShtKSwgUnYgPSBBcnJheShtKTtcbiAgICB2YXIgY291bnRzID0gbnVtZXJpYy5yZXAoW25dLDApLGk7XG4gICAgZm9yKGk9MDtpPG07KytpKSBjb3VudHNbQWpbaV1dKys7XG4gICAgZm9yKGk9MDtpPG47KytpKSBSaVtpKzFdID0gUmlbaV0gKyBjb3VudHNbaV07XG4gICAgdmFyIHB0ciA9IFJpLnNsaWNlKDApLGssQWlpO1xuICAgIGZvcihpPTA7aTxtOysraSkge1xuICAgICAgICBBaWkgPSBBaltpXTtcbiAgICAgICAgayA9IHB0cltBaWldO1xuICAgICAgICBSaltrXSA9IEFpW2ldO1xuICAgICAgICBSdltrXSA9IEF2W2ldO1xuICAgICAgICBwdHJbQWlpXT1wdHJbQWlpXSsxO1xuICAgIH1cbiAgICByZXR1cm4gW1JpLFJqLFJ2XTtcbn1cblxubnVtZXJpYy5jY3NHYXRoZXIgPSBmdW5jdGlvbiBjY3NHYXRoZXIoQSkge1xuICAgIHZhciBBaSA9IEFbMF0sIEFqID0gQVsxXSwgQXYgPSBBWzJdO1xuICAgIHZhciBuID0gQWkubGVuZ3RoLTEsbSA9IEFqLmxlbmd0aDtcbiAgICB2YXIgUmkgPSBBcnJheShtKSwgUmogPSBBcnJheShtKSwgUnYgPSBBcnJheShtKTtcbiAgICB2YXIgaSxqLGowLGoxLHA7XG4gICAgcD0wO1xuICAgIGZvcihpPTA7aTxuOysraSkge1xuICAgICAgICBqMCA9IEFpW2ldO1xuICAgICAgICBqMSA9IEFpW2krMV07XG4gICAgICAgIGZvcihqPWowO2ohPT1qMTsrK2opIHtcbiAgICAgICAgICAgIFJqW3BdID0gaTtcbiAgICAgICAgICAgIFJpW3BdID0gQWpbal07XG4gICAgICAgICAgICBSdltwXSA9IEF2W2pdO1xuICAgICAgICAgICAgKytwO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBbUmksUmosUnZdO1xufVxuXG4vLyBUaGUgZm9sbG93aW5nIHNwYXJzZSBsaW5lYXIgYWxnZWJyYSByb3V0aW5lcyBhcmUgZGVwcmVjYXRlZC5cblxubnVtZXJpYy5zZGltID0gZnVuY3Rpb24gZGltKEEscmV0LGspIHtcbiAgICBpZih0eXBlb2YgcmV0ID09PSBcInVuZGVmaW5lZFwiKSB7IHJldCA9IFtdOyB9XG4gICAgaWYodHlwZW9mIEEgIT09IFwib2JqZWN0XCIpIHJldHVybiByZXQ7XG4gICAgaWYodHlwZW9mIGsgPT09IFwidW5kZWZpbmVkXCIpIHsgaz0wOyB9XG4gICAgaWYoIShrIGluIHJldCkpIHsgcmV0W2tdID0gMDsgfVxuICAgIGlmKEEubGVuZ3RoID4gcmV0W2tdKSByZXRba10gPSBBLmxlbmd0aDtcbiAgICB2YXIgaTtcbiAgICBmb3IoaSBpbiBBKSB7XG4gICAgICAgIGlmKEEuaGFzT3duUHJvcGVydHkoaSkpIGRpbShBW2ldLHJldCxrKzEpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xufTtcblxubnVtZXJpYy5zY2xvbmUgPSBmdW5jdGlvbiBjbG9uZShBLGssbikge1xuICAgIGlmKHR5cGVvZiBrID09PSBcInVuZGVmaW5lZFwiKSB7IGs9MDsgfVxuICAgIGlmKHR5cGVvZiBuID09PSBcInVuZGVmaW5lZFwiKSB7IG4gPSBudW1lcmljLnNkaW0oQSkubGVuZ3RoOyB9XG4gICAgdmFyIGkscmV0ID0gQXJyYXkoQS5sZW5ndGgpO1xuICAgIGlmKGsgPT09IG4tMSkge1xuICAgICAgICBmb3IoaSBpbiBBKSB7IGlmKEEuaGFzT3duUHJvcGVydHkoaSkpIHJldFtpXSA9IEFbaV07IH1cbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG4gICAgZm9yKGkgaW4gQSkge1xuICAgICAgICBpZihBLmhhc093blByb3BlcnR5KGkpKSByZXRbaV0gPSBjbG9uZShBW2ldLGsrMSxuKTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbn1cblxubnVtZXJpYy5zZGlhZyA9IGZ1bmN0aW9uIGRpYWcoZCkge1xuICAgIHZhciBuID0gZC5sZW5ndGgsaSxyZXQgPSBBcnJheShuKSxpMSxpMixpMztcbiAgICBmb3IoaT1uLTE7aT49MTtpLT0yKSB7XG4gICAgICAgIGkxID0gaS0xO1xuICAgICAgICByZXRbaV0gPSBbXTsgcmV0W2ldW2ldID0gZFtpXTtcbiAgICAgICAgcmV0W2kxXSA9IFtdOyByZXRbaTFdW2kxXSA9IGRbaTFdO1xuICAgIH1cbiAgICBpZihpPT09MCkgeyByZXRbMF0gPSBbXTsgcmV0WzBdWzBdID0gZFtpXTsgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbm51bWVyaWMuc2lkZW50aXR5ID0gZnVuY3Rpb24gaWRlbnRpdHkobikgeyByZXR1cm4gbnVtZXJpYy5zZGlhZyhudW1lcmljLnJlcChbbl0sMSkpOyB9XG5cbm51bWVyaWMuc3RyYW5zcG9zZSA9IGZ1bmN0aW9uIHRyYW5zcG9zZShBKSB7XG4gICAgdmFyIHJldCA9IFtdLCBuID0gQS5sZW5ndGgsIGksaixBaTtcbiAgICBmb3IoaSBpbiBBKSB7XG4gICAgICAgIGlmKCEoQS5oYXNPd25Qcm9wZXJ0eShpKSkpIGNvbnRpbnVlO1xuICAgICAgICBBaSA9IEFbaV07XG4gICAgICAgIGZvcihqIGluIEFpKSB7XG4gICAgICAgICAgICBpZighKEFpLmhhc093blByb3BlcnR5KGopKSkgY29udGludWU7XG4gICAgICAgICAgICBpZih0eXBlb2YgcmV0W2pdICE9PSBcIm9iamVjdFwiKSB7IHJldFtqXSA9IFtdOyB9XG4gICAgICAgICAgICByZXRbal1baV0gPSBBaVtqXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0O1xufVxuXG5udW1lcmljLnNMVVAgPSBmdW5jdGlvbiBMVVAoQSx0b2wpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgZnVuY3Rpb24gbnVtZXJpYy5zTFVQIGhhZCBhIGJ1ZyBpbiBpdCBhbmQgaGFzIGJlZW4gcmVtb3ZlZC4gUGxlYXNlIHVzZSB0aGUgbmV3IG51bWVyaWMuY2NzTFVQIGZ1bmN0aW9uIGluc3RlYWQuXCIpO1xufTtcblxubnVtZXJpYy5zZG90TU0gPSBmdW5jdGlvbiBkb3RNTShBLEIpIHtcbiAgICB2YXIgcCA9IEEubGVuZ3RoLCBxID0gQi5sZW5ndGgsIEJUID0gbnVtZXJpYy5zdHJhbnNwb3NlKEIpLCByID0gQlQubGVuZ3RoLCBBaSwgQlRrO1xuICAgIHZhciBpLGosayxhY2N1bTtcbiAgICB2YXIgcmV0ID0gQXJyYXkocCkscmV0aTtcbiAgICBmb3IoaT1wLTE7aT49MDtpLS0pIHtcbiAgICAgICAgcmV0aSA9IFtdO1xuICAgICAgICBBaSA9IEFbaV07XG4gICAgICAgIGZvcihrPXItMTtrPj0wO2stLSkge1xuICAgICAgICAgICAgYWNjdW0gPSAwO1xuICAgICAgICAgICAgQlRrID0gQlRba107XG4gICAgICAgICAgICBmb3IoaiBpbiBBaSkge1xuICAgICAgICAgICAgICAgIGlmKCEoQWkuaGFzT3duUHJvcGVydHkoaikpKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBpZihqIGluIEJUaykgeyBhY2N1bSArPSBBaVtqXSpCVGtbal07IH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKGFjY3VtKSByZXRpW2tdID0gYWNjdW07XG4gICAgICAgIH1cbiAgICAgICAgcmV0W2ldID0gcmV0aTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbn1cblxubnVtZXJpYy5zZG90TVYgPSBmdW5jdGlvbiBkb3RNVihBLHgpIHtcbiAgICB2YXIgcCA9IEEubGVuZ3RoLCBBaSwgaSxqO1xuICAgIHZhciByZXQgPSBBcnJheShwKSwgYWNjdW07XG4gICAgZm9yKGk9cC0xO2k+PTA7aS0tKSB7XG4gICAgICAgIEFpID0gQVtpXTtcbiAgICAgICAgYWNjdW0gPSAwO1xuICAgICAgICBmb3IoaiBpbiBBaSkge1xuICAgICAgICAgICAgaWYoIShBaS5oYXNPd25Qcm9wZXJ0eShqKSkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgaWYoeFtqXSkgYWNjdW0gKz0gQWlbal0qeFtqXTtcbiAgICAgICAgfVxuICAgICAgICBpZihhY2N1bSkgcmV0W2ldID0gYWNjdW07XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbm51bWVyaWMuc2RvdFZNID0gZnVuY3Rpb24gZG90TVYoeCxBKSB7XG4gICAgdmFyIGksaixBaSxhbHBoYTtcbiAgICB2YXIgcmV0ID0gW10sIGFjY3VtO1xuICAgIGZvcihpIGluIHgpIHtcbiAgICAgICAgaWYoIXguaGFzT3duUHJvcGVydHkoaSkpIGNvbnRpbnVlO1xuICAgICAgICBBaSA9IEFbaV07XG4gICAgICAgIGFscGhhID0geFtpXTtcbiAgICAgICAgZm9yKGogaW4gQWkpIHtcbiAgICAgICAgICAgIGlmKCFBaS5oYXNPd25Qcm9wZXJ0eShqKSkgY29udGludWU7XG4gICAgICAgICAgICBpZighcmV0W2pdKSB7IHJldFtqXSA9IDA7IH1cbiAgICAgICAgICAgIHJldFtqXSArPSBhbHBoYSpBaVtqXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0O1xufVxuXG5udW1lcmljLnNkb3RWViA9IGZ1bmN0aW9uIGRvdFZWKHgseSkge1xuICAgIHZhciBpLHJldD0wO1xuICAgIGZvcihpIGluIHgpIHsgaWYoeFtpXSAmJiB5W2ldKSByZXQrPSB4W2ldKnlbaV07IH1cbiAgICByZXR1cm4gcmV0O1xufVxuXG5udW1lcmljLnNkb3QgPSBmdW5jdGlvbiBkb3QoQSxCKSB7XG4gICAgdmFyIG0gPSBudW1lcmljLnNkaW0oQSkubGVuZ3RoLCBuID0gbnVtZXJpYy5zZGltKEIpLmxlbmd0aDtcbiAgICB2YXIgayA9IG0qMTAwMCtuO1xuICAgIHN3aXRjaChrKSB7XG4gICAgY2FzZSAwOiByZXR1cm4gQSpCO1xuICAgIGNhc2UgMTAwMTogcmV0dXJuIG51bWVyaWMuc2RvdFZWKEEsQik7XG4gICAgY2FzZSAyMDAxOiByZXR1cm4gbnVtZXJpYy5zZG90TVYoQSxCKTtcbiAgICBjYXNlIDEwMDI6IHJldHVybiBudW1lcmljLnNkb3RWTShBLEIpO1xuICAgIGNhc2UgMjAwMjogcmV0dXJuIG51bWVyaWMuc2RvdE1NKEEsQik7XG4gICAgZGVmYXVsdDogdGhyb3cgbmV3IEVycm9yKCdudW1lcmljLnNkb3Qgbm90IGltcGxlbWVudGVkIGZvciB0ZW5zb3JzIG9mIG9yZGVyICcrbSsnIGFuZCAnK24pO1xuICAgIH1cbn1cblxubnVtZXJpYy5zc2NhdHRlciA9IGZ1bmN0aW9uIHNjYXR0ZXIoVikge1xuICAgIHZhciBuID0gVlswXS5sZW5ndGgsIFZpaiwgaSwgaiwgbSA9IFYubGVuZ3RoLCBBID0gW10sIEFqO1xuICAgIGZvcihpPW4tMTtpPj0wOy0taSkge1xuICAgICAgICBpZighVlttLTFdW2ldKSBjb250aW51ZTtcbiAgICAgICAgQWogPSBBO1xuICAgICAgICBmb3Ioaj0wO2o8bS0yO2orKykge1xuICAgICAgICAgICAgVmlqID0gVltqXVtpXTtcbiAgICAgICAgICAgIGlmKCFBaltWaWpdKSBBaltWaWpdID0gW107XG4gICAgICAgICAgICBBaiA9IEFqW1Zpal07XG4gICAgICAgIH1cbiAgICAgICAgQWpbVltqXVtpXV0gPSBWW2orMV1baV07XG4gICAgfVxuICAgIHJldHVybiBBO1xufVxuXG5udW1lcmljLnNnYXRoZXIgPSBmdW5jdGlvbiBnYXRoZXIoQSxyZXQsaykge1xuICAgIGlmKHR5cGVvZiByZXQgPT09IFwidW5kZWZpbmVkXCIpIHJldCA9IFtdO1xuICAgIGlmKHR5cGVvZiBrID09PSBcInVuZGVmaW5lZFwiKSBrID0gW107XG4gICAgdmFyIG4saSxBaTtcbiAgICBuID0gay5sZW5ndGg7XG4gICAgZm9yKGkgaW4gQSkge1xuICAgICAgICBpZihBLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgICAgICBrW25dID0gcGFyc2VJbnQoaSk7XG4gICAgICAgICAgICBBaSA9IEFbaV07XG4gICAgICAgICAgICBpZih0eXBlb2YgQWkgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICAgICAgICBpZihBaSkge1xuICAgICAgICAgICAgICAgICAgICBpZihyZXQubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IoaT1uKzE7aT49MDstLWkpIHJldFtpXSA9IFtdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGZvcihpPW47aT49MDstLWkpIHJldFtpXS5wdXNoKGtbaV0pO1xuICAgICAgICAgICAgICAgICAgICByZXRbbisxXS5wdXNoKEFpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgZ2F0aGVyKEFpLHJldCxrKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZihrLmxlbmd0aD5uKSBrLnBvcCgpO1xuICAgIHJldHVybiByZXQ7XG59XG5cbi8vIDYuIENvb3JkaW5hdGUgbWF0cmljZXNcbm51bWVyaWMuY0xVID0gZnVuY3Rpb24gTFUoQSkge1xuICAgIHZhciBJID0gQVswXSwgSiA9IEFbMV0sIFYgPSBBWzJdO1xuICAgIHZhciBwID0gSS5sZW5ndGgsIG09MCwgaSxqLGssYSxiLGM7XG4gICAgZm9yKGk9MDtpPHA7aSsrKSBpZihJW2ldPm0pIG09SVtpXTtcbiAgICBtKys7XG4gICAgdmFyIEwgPSBBcnJheShtKSwgVSA9IEFycmF5KG0pLCBsZWZ0ID0gbnVtZXJpYy5yZXAoW21dLEluZmluaXR5KSwgcmlnaHQgPSBudW1lcmljLnJlcChbbV0sLUluZmluaXR5KTtcbiAgICB2YXIgVWksIFVqLGFscGhhO1xuICAgIGZvcihrPTA7azxwO2srKykge1xuICAgICAgICBpID0gSVtrXTtcbiAgICAgICAgaiA9IEpba107XG4gICAgICAgIGlmKGo8bGVmdFtpXSkgbGVmdFtpXSA9IGo7XG4gICAgICAgIGlmKGo+cmlnaHRbaV0pIHJpZ2h0W2ldID0gajtcbiAgICB9XG4gICAgZm9yKGk9MDtpPG0tMTtpKyspIHsgaWYocmlnaHRbaV0gPiByaWdodFtpKzFdKSByaWdodFtpKzFdID0gcmlnaHRbaV07IH1cbiAgICBmb3IoaT1tLTE7aT49MTtpLS0pIHsgaWYobGVmdFtpXTxsZWZ0W2ktMV0pIGxlZnRbaS0xXSA9IGxlZnRbaV07IH1cbiAgICB2YXIgY291bnRMID0gMCwgY291bnRVID0gMDtcbiAgICBmb3IoaT0wO2k8bTtpKyspIHtcbiAgICAgICAgVVtpXSA9IG51bWVyaWMucmVwKFtyaWdodFtpXS1sZWZ0W2ldKzFdLDApO1xuICAgICAgICBMW2ldID0gbnVtZXJpYy5yZXAoW2ktbGVmdFtpXV0sMCk7XG4gICAgICAgIGNvdW50TCArPSBpLWxlZnRbaV0rMTtcbiAgICAgICAgY291bnRVICs9IHJpZ2h0W2ldLWkrMTtcbiAgICB9XG4gICAgZm9yKGs9MDtrPHA7aysrKSB7IGkgPSBJW2tdOyBVW2ldW0pba10tbGVmdFtpXV0gPSBWW2tdOyB9XG4gICAgZm9yKGk9MDtpPG0tMTtpKyspIHtcbiAgICAgICAgYSA9IGktbGVmdFtpXTtcbiAgICAgICAgVWkgPSBVW2ldO1xuICAgICAgICBmb3Ioaj1pKzE7bGVmdFtqXTw9aSAmJiBqPG07aisrKSB7XG4gICAgICAgICAgICBiID0gaS1sZWZ0W2pdO1xuICAgICAgICAgICAgYyA9IHJpZ2h0W2ldLWk7XG4gICAgICAgICAgICBVaiA9IFVbal07XG4gICAgICAgICAgICBhbHBoYSA9IFVqW2JdL1VpW2FdO1xuICAgICAgICAgICAgaWYoYWxwaGEpIHtcbiAgICAgICAgICAgICAgICBmb3Ioaz0xO2s8PWM7aysrKSB7IFVqW2srYl0gLT0gYWxwaGEqVWlbaythXTsgfVxuICAgICAgICAgICAgICAgIExbal1baS1sZWZ0W2pdXSA9IGFscGhhO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHZhciBVaSA9IFtdLCBVaiA9IFtdLCBVdiA9IFtdLCBMaSA9IFtdLCBMaiA9IFtdLCBMdiA9IFtdO1xuICAgIHZhciBwLHEsZm9vO1xuICAgIHA9MDsgcT0wO1xuICAgIGZvcihpPTA7aTxtO2krKykge1xuICAgICAgICBhID0gbGVmdFtpXTtcbiAgICAgICAgYiA9IHJpZ2h0W2ldO1xuICAgICAgICBmb28gPSBVW2ldO1xuICAgICAgICBmb3Ioaj1pO2o8PWI7aisrKSB7XG4gICAgICAgICAgICBpZihmb29bai1hXSkge1xuICAgICAgICAgICAgICAgIFVpW3BdID0gaTtcbiAgICAgICAgICAgICAgICBValtwXSA9IGo7XG4gICAgICAgICAgICAgICAgVXZbcF0gPSBmb29bai1hXTtcbiAgICAgICAgICAgICAgICBwKys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZm9vID0gTFtpXTtcbiAgICAgICAgZm9yKGo9YTtqPGk7aisrKSB7XG4gICAgICAgICAgICBpZihmb29bai1hXSkge1xuICAgICAgICAgICAgICAgIExpW3FdID0gaTtcbiAgICAgICAgICAgICAgICBMaltxXSA9IGo7XG4gICAgICAgICAgICAgICAgTHZbcV0gPSBmb29bai1hXTtcbiAgICAgICAgICAgICAgICBxKys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgTGlbcV0gPSBpO1xuICAgICAgICBMaltxXSA9IGk7XG4gICAgICAgIEx2W3FdID0gMTtcbiAgICAgICAgcSsrO1xuICAgIH1cbiAgICByZXR1cm4ge1U6W1VpLFVqLFV2XSwgTDpbTGksTGosTHZdfTtcbn07XG5cbm51bWVyaWMuY0xVc29sdmUgPSBmdW5jdGlvbiBMVXNvbHZlKGx1LGIpIHtcbiAgICB2YXIgTCA9IGx1LkwsIFUgPSBsdS5VLCByZXQgPSBudW1lcmljLmNsb25lKGIpO1xuICAgIHZhciBMaSA9IExbMF0sIExqID0gTFsxXSwgTHYgPSBMWzJdO1xuICAgIHZhciBVaSA9IFVbMF0sIFVqID0gVVsxXSwgVXYgPSBVWzJdO1xuICAgIHZhciBwID0gVWkubGVuZ3RoLCBxID0gTGkubGVuZ3RoO1xuICAgIHZhciBtID0gcmV0Lmxlbmd0aCxpLGosaztcbiAgICBrID0gMDtcbiAgICBmb3IoaT0wO2k8bTtpKyspIHtcbiAgICAgICAgd2hpbGUoTGpba10gPCBpKSB7XG4gICAgICAgICAgICByZXRbaV0gLT0gTHZba10qcmV0W0xqW2tdXTtcbiAgICAgICAgICAgIGsrKztcbiAgICAgICAgfVxuICAgICAgICBrKys7XG4gICAgfVxuICAgIGsgPSBwLTE7XG4gICAgZm9yKGk9bS0xO2k+PTA7aS0tKSB7XG4gICAgICAgIHdoaWxlKFVqW2tdID4gaSkge1xuICAgICAgICAgICAgcmV0W2ldIC09IFV2W2tdKnJldFtValtrXV07XG4gICAgICAgICAgICBrLS07XG4gICAgICAgIH1cbiAgICAgICAgcmV0W2ldIC89IFV2W2tdO1xuICAgICAgICBrLS07XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG59O1xuXG5udW1lcmljLmNncmlkID0gZnVuY3Rpb24gZ3JpZChuLHNoYXBlKSB7XG4gICAgaWYodHlwZW9mIG4gPT09IFwibnVtYmVyXCIpIG4gPSBbbixuXTtcbiAgICB2YXIgcmV0ID0gbnVtZXJpYy5yZXAobiwtMSk7XG4gICAgdmFyIGksaixjb3VudDtcbiAgICBpZih0eXBlb2Ygc2hhcGUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBzd2l0Y2goc2hhcGUpIHtcbiAgICAgICAgY2FzZSAnTCc6XG4gICAgICAgICAgICBzaGFwZSA9IGZ1bmN0aW9uKGksaikgeyByZXR1cm4gKGk+PW5bMF0vMiB8fCBqPG5bMV0vMik7IH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgc2hhcGUgPSBmdW5jdGlvbihpLGopIHsgcmV0dXJuIHRydWU7IH07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb3VudD0wO1xuICAgIGZvcihpPTE7aTxuWzBdLTE7aSsrKSBmb3Ioaj0xO2o8blsxXS0xO2orKykgXG4gICAgICAgIGlmKHNoYXBlKGksaikpIHtcbiAgICAgICAgICAgIHJldFtpXVtqXSA9IGNvdW50O1xuICAgICAgICAgICAgY291bnQrKztcbiAgICAgICAgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbm51bWVyaWMuY2RlbHNxID0gZnVuY3Rpb24gZGVsc3EoZykge1xuICAgIHZhciBkaXIgPSBbWy0xLDBdLFswLC0xXSxbMCwxXSxbMSwwXV07XG4gICAgdmFyIHMgPSBudW1lcmljLmRpbShnKSwgbSA9IHNbMF0sIG4gPSBzWzFdLCBpLGosayxwLHE7XG4gICAgdmFyIExpID0gW10sIExqID0gW10sIEx2ID0gW107XG4gICAgZm9yKGk9MTtpPG0tMTtpKyspIGZvcihqPTE7ajxuLTE7aisrKSB7XG4gICAgICAgIGlmKGdbaV1bal08MCkgY29udGludWU7XG4gICAgICAgIGZvcihrPTA7azw0O2srKykge1xuICAgICAgICAgICAgcCA9IGkrZGlyW2tdWzBdO1xuICAgICAgICAgICAgcSA9IGorZGlyW2tdWzFdO1xuICAgICAgICAgICAgaWYoZ1twXVtxXTwwKSBjb250aW51ZTtcbiAgICAgICAgICAgIExpLnB1c2goZ1tpXVtqXSk7XG4gICAgICAgICAgICBMai5wdXNoKGdbcF1bcV0pO1xuICAgICAgICAgICAgTHYucHVzaCgtMSk7XG4gICAgICAgIH1cbiAgICAgICAgTGkucHVzaChnW2ldW2pdKTtcbiAgICAgICAgTGoucHVzaChnW2ldW2pdKTtcbiAgICAgICAgTHYucHVzaCg0KTtcbiAgICB9XG4gICAgcmV0dXJuIFtMaSxMaixMdl07XG59XG5cbm51bWVyaWMuY2RvdE1WID0gZnVuY3Rpb24gZG90TVYoQSx4KSB7XG4gICAgdmFyIHJldCwgQWkgPSBBWzBdLCBBaiA9IEFbMV0sIEF2ID0gQVsyXSxrLHA9QWkubGVuZ3RoLE47XG4gICAgTj0wO1xuICAgIGZvcihrPTA7azxwO2srKykgeyBpZihBaVtrXT5OKSBOID0gQWlba107IH1cbiAgICBOKys7XG4gICAgcmV0ID0gbnVtZXJpYy5yZXAoW05dLDApO1xuICAgIGZvcihrPTA7azxwO2srKykgeyByZXRbQWlba11dKz1BdltrXSp4W0FqW2tdXTsgfVxuICAgIHJldHVybiByZXQ7XG59XG5cbi8vIDcuIFNwbGluZXNcblxubnVtZXJpYy5TcGxpbmUgPSBmdW5jdGlvbiBTcGxpbmUoeCx5bCx5cixrbCxrcikgeyB0aGlzLnggPSB4OyB0aGlzLnlsID0geWw7IHRoaXMueXIgPSB5cjsgdGhpcy5rbCA9IGtsOyB0aGlzLmtyID0ga3I7IH1cbm51bWVyaWMuU3BsaW5lLnByb3RvdHlwZS5fYXQgPSBmdW5jdGlvbiBfYXQoeDEscCkge1xuICAgIHZhciB4ID0gdGhpcy54O1xuICAgIHZhciB5bCA9IHRoaXMueWw7XG4gICAgdmFyIHlyID0gdGhpcy55cjtcbiAgICB2YXIga2wgPSB0aGlzLmtsO1xuICAgIHZhciBrciA9IHRoaXMua3I7XG4gICAgdmFyIHgxLGEsYix0O1xuICAgIHZhciBhZGQgPSBudW1lcmljLmFkZCwgc3ViID0gbnVtZXJpYy5zdWIsIG11bCA9IG51bWVyaWMubXVsO1xuICAgIGEgPSBzdWIobXVsKGtsW3BdLHhbcCsxXS14W3BdKSxzdWIoeXJbcCsxXSx5bFtwXSkpO1xuICAgIGIgPSBhZGQobXVsKGtyW3ArMV0seFtwXS14W3ArMV0pLHN1Yih5cltwKzFdLHlsW3BdKSk7XG4gICAgdCA9ICh4MS14W3BdKS8oeFtwKzFdLXhbcF0pO1xuICAgIHZhciBzID0gdCooMS10KTtcbiAgICByZXR1cm4gYWRkKGFkZChhZGQobXVsKDEtdCx5bFtwXSksbXVsKHQseXJbcCsxXSkpLG11bChhLHMqKDEtdCkpKSxtdWwoYixzKnQpKTtcbn1cbm51bWVyaWMuU3BsaW5lLnByb3RvdHlwZS5hdCA9IGZ1bmN0aW9uIGF0KHgwKSB7XG4gICAgaWYodHlwZW9mIHgwID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHZhciB4ID0gdGhpcy54O1xuICAgICAgICB2YXIgbiA9IHgubGVuZ3RoO1xuICAgICAgICB2YXIgcCxxLG1pZCxmbG9vciA9IE1hdGguZmxvb3IsYSxiLHQ7XG4gICAgICAgIHAgPSAwO1xuICAgICAgICBxID0gbi0xO1xuICAgICAgICB3aGlsZShxLXA+MSkge1xuICAgICAgICAgICAgbWlkID0gZmxvb3IoKHArcSkvMik7XG4gICAgICAgICAgICBpZih4W21pZF0gPD0geDApIHAgPSBtaWQ7XG4gICAgICAgICAgICBlbHNlIHEgPSBtaWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2F0KHgwLHApO1xuICAgIH1cbiAgICB2YXIgbiA9IHgwLmxlbmd0aCwgaSwgcmV0ID0gQXJyYXkobik7XG4gICAgZm9yKGk9bi0xO2khPT0tMTstLWkpIHJldFtpXSA9IHRoaXMuYXQoeDBbaV0pO1xuICAgIHJldHVybiByZXQ7XG59XG5udW1lcmljLlNwbGluZS5wcm90b3R5cGUuZGlmZiA9IGZ1bmN0aW9uIGRpZmYoKSB7XG4gICAgdmFyIHggPSB0aGlzLng7XG4gICAgdmFyIHlsID0gdGhpcy55bDtcbiAgICB2YXIgeXIgPSB0aGlzLnlyO1xuICAgIHZhciBrbCA9IHRoaXMua2w7XG4gICAgdmFyIGtyID0gdGhpcy5rcjtcbiAgICB2YXIgbiA9IHlsLmxlbmd0aDtcbiAgICB2YXIgaSxkeCxkeTtcbiAgICB2YXIgemwgPSBrbCwgenIgPSBrciwgcGwgPSBBcnJheShuKSwgcHIgPSBBcnJheShuKTtcbiAgICB2YXIgYWRkID0gbnVtZXJpYy5hZGQsIG11bCA9IG51bWVyaWMubXVsLCBkaXYgPSBudW1lcmljLmRpdiwgc3ViID0gbnVtZXJpYy5zdWI7XG4gICAgZm9yKGk9bi0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgZHggPSB4W2krMV0teFtpXTtcbiAgICAgICAgZHkgPSBzdWIoeXJbaSsxXSx5bFtpXSk7XG4gICAgICAgIHBsW2ldID0gZGl2KGFkZChtdWwoZHksIDYpLG11bChrbFtpXSwtNCpkeCksbXVsKGtyW2krMV0sLTIqZHgpKSxkeCpkeCk7XG4gICAgICAgIHByW2krMV0gPSBkaXYoYWRkKG11bChkeSwtNiksbXVsKGtsW2ldLCAyKmR4KSxtdWwoa3JbaSsxXSwgNCpkeCkpLGR4KmR4KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBudW1lcmljLlNwbGluZSh4LHpsLHpyLHBsLHByKTtcbn1cbm51bWVyaWMuU3BsaW5lLnByb3RvdHlwZS5yb290cyA9IGZ1bmN0aW9uIHJvb3RzKCkge1xuICAgIGZ1bmN0aW9uIHNxcih4KSB7IHJldHVybiB4Kng7IH1cbiAgICBmdW5jdGlvbiBoZXZhbCh5MCx5MSxrMCxrMSx4KSB7XG4gICAgICAgIHZhciBBID0gazAqMi0oeTEteTApO1xuICAgICAgICB2YXIgQiA9IC1rMSoyKyh5MS15MCk7XG4gICAgICAgIHZhciB0ID0gKHgrMSkqMC41O1xuICAgICAgICB2YXIgcyA9IHQqKDEtdCk7XG4gICAgICAgIHJldHVybiAoMS10KSp5MCt0KnkxK0EqcyooMS10KStCKnMqdDtcbiAgICB9XG4gICAgdmFyIHJldCA9IFtdO1xuICAgIHZhciB4ID0gdGhpcy54LCB5bCA9IHRoaXMueWwsIHlyID0gdGhpcy55ciwga2wgPSB0aGlzLmtsLCBrciA9IHRoaXMua3I7XG4gICAgaWYodHlwZW9mIHlsWzBdID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHlsID0gW3lsXTtcbiAgICAgICAgeXIgPSBbeXJdO1xuICAgICAgICBrbCA9IFtrbF07XG4gICAgICAgIGtyID0gW2tyXTtcbiAgICB9XG4gICAgdmFyIG0gPSB5bC5sZW5ndGgsbj14Lmxlbmd0aC0xLGksaixrLHkscyx0O1xuICAgIHZhciBhaSxiaSxjaSxkaSwgcmV0ID0gQXJyYXkobSkscmksazAsazEseTAseTEsQSxCLEQsZHgsY3gsc3RvcHMsejAsejEsem0sdDAsdDEsdG07XG4gICAgdmFyIHNxcnQgPSBNYXRoLnNxcnQ7XG4gICAgZm9yKGk9MDtpIT09bTsrK2kpIHtcbiAgICAgICAgYWkgPSB5bFtpXTtcbiAgICAgICAgYmkgPSB5cltpXTtcbiAgICAgICAgY2kgPSBrbFtpXTtcbiAgICAgICAgZGkgPSBrcltpXTtcbiAgICAgICAgcmkgPSBbXTtcbiAgICAgICAgZm9yKGo9MDtqIT09bjtqKyspIHtcbiAgICAgICAgICAgIGlmKGo+MCAmJiBiaVtqXSphaVtqXTwwKSByaS5wdXNoKHhbal0pO1xuICAgICAgICAgICAgZHggPSAoeFtqKzFdLXhbal0pO1xuICAgICAgICAgICAgY3ggPSB4W2pdO1xuICAgICAgICAgICAgeTAgPSBhaVtqXTtcbiAgICAgICAgICAgIHkxID0gYmlbaisxXTtcbiAgICAgICAgICAgIGswID0gY2lbal0vZHg7XG4gICAgICAgICAgICBrMSA9IGRpW2orMV0vZHg7XG4gICAgICAgICAgICBEID0gc3FyKGswLWsxKzMqKHkwLXkxKSkgKyAxMiprMSp5MDtcbiAgICAgICAgICAgIEEgPSBrMSszKnkwKzIqazAtMyp5MTtcbiAgICAgICAgICAgIEIgPSAzKihrMStrMCsyKih5MC15MSkpO1xuICAgICAgICAgICAgaWYoRDw9MCkge1xuICAgICAgICAgICAgICAgIHowID0gQS9CO1xuICAgICAgICAgICAgICAgIGlmKHowPnhbal0gJiYgejA8eFtqKzFdKSBzdG9wcyA9IFt4W2pdLHowLHhbaisxXV07XG4gICAgICAgICAgICAgICAgZWxzZSBzdG9wcyA9IFt4W2pdLHhbaisxXV07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHowID0gKEEtc3FydChEKSkvQjtcbiAgICAgICAgICAgICAgICB6MSA9IChBK3NxcnQoRCkpL0I7XG4gICAgICAgICAgICAgICAgc3RvcHMgPSBbeFtqXV07XG4gICAgICAgICAgICAgICAgaWYoejA+eFtqXSAmJiB6MDx4W2orMV0pIHN0b3BzLnB1c2goejApO1xuICAgICAgICAgICAgICAgIGlmKHoxPnhbal0gJiYgejE8eFtqKzFdKSBzdG9wcy5wdXNoKHoxKTtcbiAgICAgICAgICAgICAgICBzdG9wcy5wdXNoKHhbaisxXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0MCA9IHN0b3BzWzBdO1xuICAgICAgICAgICAgejAgPSB0aGlzLl9hdCh0MCxqKTtcbiAgICAgICAgICAgIGZvcihrPTA7azxzdG9wcy5sZW5ndGgtMTtrKyspIHtcbiAgICAgICAgICAgICAgICB0MSA9IHN0b3BzW2srMV07XG4gICAgICAgICAgICAgICAgejEgPSB0aGlzLl9hdCh0MSxqKTtcbiAgICAgICAgICAgICAgICBpZih6MCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICByaS5wdXNoKHQwKTsgXG4gICAgICAgICAgICAgICAgICAgIHQwID0gdDE7XG4gICAgICAgICAgICAgICAgICAgIHowID0gejE7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZih6MSA9PT0gMCB8fCB6MCp6MT4wKSB7XG4gICAgICAgICAgICAgICAgICAgIHQwID0gdDE7XG4gICAgICAgICAgICAgICAgICAgIHowID0gejE7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YXIgc2lkZSA9IDA7XG4gICAgICAgICAgICAgICAgd2hpbGUoMSkge1xuICAgICAgICAgICAgICAgICAgICB0bSA9ICh6MCp0MS16MSp0MCkvKHowLXoxKTtcbiAgICAgICAgICAgICAgICAgICAgaWYodG0gPD0gdDAgfHwgdG0gPj0gdDEpIHsgYnJlYWs7IH1cbiAgICAgICAgICAgICAgICAgICAgem0gPSB0aGlzLl9hdCh0bSxqKTtcbiAgICAgICAgICAgICAgICAgICAgaWYoem0qejE+MCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdDEgPSB0bTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHoxID0gem07XG4gICAgICAgICAgICAgICAgICAgICAgICBpZihzaWRlID09PSAtMSkgejAqPTAuNTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpZGUgPSAtMTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmKHptKnowPjApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHQwID0gdG07XG4gICAgICAgICAgICAgICAgICAgICAgICB6MCA9IHptO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYoc2lkZSA9PT0gMSkgejEqPTAuNTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpZGUgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJpLnB1c2godG0pO1xuICAgICAgICAgICAgICAgIHQwID0gc3RvcHNbaysxXTtcbiAgICAgICAgICAgICAgICB6MCA9IHRoaXMuX2F0KHQwLCBqKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHoxID09PSAwKSByaS5wdXNoKHQxKTtcbiAgICAgICAgfVxuICAgICAgICByZXRbaV0gPSByaTtcbiAgICB9XG4gICAgaWYodHlwZW9mIHRoaXMueWxbMF0gPT09IFwibnVtYmVyXCIpIHJldHVybiByZXRbMF07XG4gICAgcmV0dXJuIHJldDtcbn1cbm51bWVyaWMuc3BsaW5lID0gZnVuY3Rpb24gc3BsaW5lKHgseSxrMSxrbikge1xuICAgIHZhciBuID0geC5sZW5ndGgsIGIgPSBbXSwgZHggPSBbXSwgZHkgPSBbXTtcbiAgICB2YXIgaTtcbiAgICB2YXIgc3ViID0gbnVtZXJpYy5zdWIsbXVsID0gbnVtZXJpYy5tdWwsYWRkID0gbnVtZXJpYy5hZGQ7XG4gICAgZm9yKGk9bi0yO2k+PTA7aS0tKSB7IGR4W2ldID0geFtpKzFdLXhbaV07IGR5W2ldID0gc3ViKHlbaSsxXSx5W2ldKTsgfVxuICAgIGlmKHR5cGVvZiBrMSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2Yga24gPT09IFwic3RyaW5nXCIpIHsgXG4gICAgICAgIGsxID0ga24gPSBcInBlcmlvZGljXCI7XG4gICAgfVxuICAgIC8vIEJ1aWxkIHNwYXJzZSB0cmlkaWFnb25hbCBzeXN0ZW1cbiAgICB2YXIgVCA9IFtbXSxbXSxbXV07XG4gICAgc3dpdGNoKHR5cGVvZiBrMSkge1xuICAgIGNhc2UgXCJ1bmRlZmluZWRcIjpcbiAgICAgICAgYlswXSA9IG11bCgzLyhkeFswXSpkeFswXSksZHlbMF0pO1xuICAgICAgICBUWzBdLnB1c2goMCwwKTtcbiAgICAgICAgVFsxXS5wdXNoKDAsMSk7XG4gICAgICAgIFRbMl0ucHVzaCgyL2R4WzBdLDEvZHhbMF0pO1xuICAgICAgICBicmVhaztcbiAgICBjYXNlIFwic3RyaW5nXCI6XG4gICAgICAgIGJbMF0gPSBhZGQobXVsKDMvKGR4W24tMl0qZHhbbi0yXSksZHlbbi0yXSksbXVsKDMvKGR4WzBdKmR4WzBdKSxkeVswXSkpO1xuICAgICAgICBUWzBdLnB1c2goMCwwLDApO1xuICAgICAgICBUWzFdLnB1c2gobi0yLDAsMSk7XG4gICAgICAgIFRbMl0ucHVzaCgxL2R4W24tMl0sMi9keFtuLTJdKzIvZHhbMF0sMS9keFswXSk7XG4gICAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICAgIGJbMF0gPSBrMTtcbiAgICAgICAgVFswXS5wdXNoKDApO1xuICAgICAgICBUWzFdLnB1c2goMCk7XG4gICAgICAgIFRbMl0ucHVzaCgxKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGZvcihpPTE7aTxuLTE7aSsrKSB7XG4gICAgICAgIGJbaV0gPSBhZGQobXVsKDMvKGR4W2ktMV0qZHhbaS0xXSksZHlbaS0xXSksbXVsKDMvKGR4W2ldKmR4W2ldKSxkeVtpXSkpO1xuICAgICAgICBUWzBdLnB1c2goaSxpLGkpO1xuICAgICAgICBUWzFdLnB1c2goaS0xLGksaSsxKTtcbiAgICAgICAgVFsyXS5wdXNoKDEvZHhbaS0xXSwyL2R4W2ktMV0rMi9keFtpXSwxL2R4W2ldKTtcbiAgICB9XG4gICAgc3dpdGNoKHR5cGVvZiBrbikge1xuICAgIGNhc2UgXCJ1bmRlZmluZWRcIjpcbiAgICAgICAgYltuLTFdID0gbXVsKDMvKGR4W24tMl0qZHhbbi0yXSksZHlbbi0yXSk7XG4gICAgICAgIFRbMF0ucHVzaChuLTEsbi0xKTtcbiAgICAgICAgVFsxXS5wdXNoKG4tMixuLTEpO1xuICAgICAgICBUWzJdLnB1c2goMS9keFtuLTJdLDIvZHhbbi0yXSk7XG4gICAgICAgIGJyZWFrO1xuICAgIGNhc2UgXCJzdHJpbmdcIjpcbiAgICAgICAgVFsxXVtUWzFdLmxlbmd0aC0xXSA9IDA7XG4gICAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICAgIGJbbi0xXSA9IGtuO1xuICAgICAgICBUWzBdLnB1c2gobi0xKTtcbiAgICAgICAgVFsxXS5wdXNoKG4tMSk7XG4gICAgICAgIFRbMl0ucHVzaCgxKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmKHR5cGVvZiBiWzBdICE9PSBcIm51bWJlclwiKSBiID0gbnVtZXJpYy50cmFuc3Bvc2UoYik7XG4gICAgZWxzZSBiID0gW2JdO1xuICAgIHZhciBrID0gQXJyYXkoYi5sZW5ndGgpO1xuICAgIGlmKHR5cGVvZiBrMSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBmb3IoaT1rLmxlbmd0aC0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgICAgIGtbaV0gPSBudW1lcmljLmNjc0xVUFNvbHZlKG51bWVyaWMuY2NzTFVQKG51bWVyaWMuY2NzU2NhdHRlcihUKSksYltpXSk7XG4gICAgICAgICAgICBrW2ldW24tMV0gPSBrW2ldWzBdO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgZm9yKGk9ay5sZW5ndGgtMTtpIT09LTE7LS1pKSB7XG4gICAgICAgICAgICBrW2ldID0gbnVtZXJpYy5jTFVzb2x2ZShudW1lcmljLmNMVShUKSxiW2ldKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZih0eXBlb2YgeVswXSA9PT0gXCJudW1iZXJcIikgayA9IGtbMF07XG4gICAgZWxzZSBrID0gbnVtZXJpYy50cmFuc3Bvc2Uoayk7XG4gICAgcmV0dXJuIG5ldyBudW1lcmljLlNwbGluZSh4LHkseSxrLGspO1xufVxuXG4vLyA4LiBGRlRcbm51bWVyaWMuZmZ0cG93MiA9IGZ1bmN0aW9uIGZmdHBvdzIoeCx5KSB7XG4gICAgdmFyIG4gPSB4Lmxlbmd0aDtcbiAgICBpZihuID09PSAxKSByZXR1cm47XG4gICAgdmFyIGNvcyA9IE1hdGguY29zLCBzaW4gPSBNYXRoLnNpbiwgaSxqO1xuICAgIHZhciB4ZSA9IEFycmF5KG4vMiksIHllID0gQXJyYXkobi8yKSwgeG8gPSBBcnJheShuLzIpLCB5byA9IEFycmF5KG4vMik7XG4gICAgaiA9IG4vMjtcbiAgICBmb3IoaT1uLTE7aSE9PS0xOy0taSkge1xuICAgICAgICAtLWo7XG4gICAgICAgIHhvW2pdID0geFtpXTtcbiAgICAgICAgeW9bal0gPSB5W2ldO1xuICAgICAgICAtLWk7XG4gICAgICAgIHhlW2pdID0geFtpXTtcbiAgICAgICAgeWVbal0gPSB5W2ldO1xuICAgIH1cbiAgICBmZnRwb3cyKHhlLHllKTtcbiAgICBmZnRwb3cyKHhvLHlvKTtcbiAgICBqID0gbi8yO1xuICAgIHZhciB0LGsgPSAoLTYuMjgzMTg1MzA3MTc5NTg2NDc2OTI1Mjg2NzY2NTU5MDA1NzY4Mzk0MzM4Nzk4NzUwMjExNjQxOS9uKSxjaSxzaTtcbiAgICBmb3IoaT1uLTE7aSE9PS0xOy0taSkge1xuICAgICAgICAtLWo7XG4gICAgICAgIGlmKGogPT09IC0xKSBqID0gbi8yLTE7XG4gICAgICAgIHQgPSBrKmk7XG4gICAgICAgIGNpID0gY29zKHQpO1xuICAgICAgICBzaSA9IHNpbih0KTtcbiAgICAgICAgeFtpXSA9IHhlW2pdICsgY2kqeG9bal0gLSBzaSp5b1tqXTtcbiAgICAgICAgeVtpXSA9IHllW2pdICsgY2kqeW9bal0gKyBzaSp4b1tqXTtcbiAgICB9XG59XG5udW1lcmljLl9pZmZ0cG93MiA9IGZ1bmN0aW9uIF9pZmZ0cG93Mih4LHkpIHtcbiAgICB2YXIgbiA9IHgubGVuZ3RoO1xuICAgIGlmKG4gPT09IDEpIHJldHVybjtcbiAgICB2YXIgY29zID0gTWF0aC5jb3MsIHNpbiA9IE1hdGguc2luLCBpLGo7XG4gICAgdmFyIHhlID0gQXJyYXkobi8yKSwgeWUgPSBBcnJheShuLzIpLCB4byA9IEFycmF5KG4vMiksIHlvID0gQXJyYXkobi8yKTtcbiAgICBqID0gbi8yO1xuICAgIGZvcihpPW4tMTtpIT09LTE7LS1pKSB7XG4gICAgICAgIC0tajtcbiAgICAgICAgeG9bal0gPSB4W2ldO1xuICAgICAgICB5b1tqXSA9IHlbaV07XG4gICAgICAgIC0taTtcbiAgICAgICAgeGVbal0gPSB4W2ldO1xuICAgICAgICB5ZVtqXSA9IHlbaV07XG4gICAgfVxuICAgIF9pZmZ0cG93Mih4ZSx5ZSk7XG4gICAgX2lmZnRwb3cyKHhvLHlvKTtcbiAgICBqID0gbi8yO1xuICAgIHZhciB0LGsgPSAoNi4yODMxODUzMDcxNzk1ODY0NzY5MjUyODY3NjY1NTkwMDU3NjgzOTQzMzg3OTg3NTAyMTE2NDE5L24pLGNpLHNpO1xuICAgIGZvcihpPW4tMTtpIT09LTE7LS1pKSB7XG4gICAgICAgIC0tajtcbiAgICAgICAgaWYoaiA9PT0gLTEpIGogPSBuLzItMTtcbiAgICAgICAgdCA9IGsqaTtcbiAgICAgICAgY2kgPSBjb3ModCk7XG4gICAgICAgIHNpID0gc2luKHQpO1xuICAgICAgICB4W2ldID0geGVbal0gKyBjaSp4b1tqXSAtIHNpKnlvW2pdO1xuICAgICAgICB5W2ldID0geWVbal0gKyBjaSp5b1tqXSArIHNpKnhvW2pdO1xuICAgIH1cbn1cbm51bWVyaWMuaWZmdHBvdzIgPSBmdW5jdGlvbiBpZmZ0cG93Mih4LHkpIHtcbiAgICBudW1lcmljLl9pZmZ0cG93Mih4LHkpO1xuICAgIG51bWVyaWMuZGl2ZXEoeCx4Lmxlbmd0aCk7XG4gICAgbnVtZXJpYy5kaXZlcSh5LHkubGVuZ3RoKTtcbn1cbm51bWVyaWMuY29udnBvdzIgPSBmdW5jdGlvbiBjb252cG93MihheCxheSxieCxieSkge1xuICAgIG51bWVyaWMuZmZ0cG93MihheCxheSk7XG4gICAgbnVtZXJpYy5mZnRwb3cyKGJ4LGJ5KTtcbiAgICB2YXIgaSxuID0gYXgubGVuZ3RoLGF4aSxieGksYXlpLGJ5aTtcbiAgICBmb3IoaT1uLTE7aSE9PS0xOy0taSkge1xuICAgICAgICBheGkgPSBheFtpXTsgYXlpID0gYXlbaV07IGJ4aSA9IGJ4W2ldOyBieWkgPSBieVtpXTtcbiAgICAgICAgYXhbaV0gPSBheGkqYnhpLWF5aSpieWk7XG4gICAgICAgIGF5W2ldID0gYXhpKmJ5aStheWkqYnhpO1xuICAgIH1cbiAgICBudW1lcmljLmlmZnRwb3cyKGF4LGF5KTtcbn1cbm51bWVyaWMuVC5wcm90b3R5cGUuZmZ0ID0gZnVuY3Rpb24gZmZ0KCkge1xuICAgIHZhciB4ID0gdGhpcy54LCB5ID0gdGhpcy55O1xuICAgIHZhciBuID0geC5sZW5ndGgsIGxvZyA9IE1hdGgubG9nLCBsb2cyID0gbG9nKDIpLFxuICAgICAgICBwID0gTWF0aC5jZWlsKGxvZygyKm4tMSkvbG9nMiksIG0gPSBNYXRoLnBvdygyLHApO1xuICAgIHZhciBjeCA9IG51bWVyaWMucmVwKFttXSwwKSwgY3kgPSBudW1lcmljLnJlcChbbV0sMCksIGNvcyA9IE1hdGguY29zLCBzaW4gPSBNYXRoLnNpbjtcbiAgICB2YXIgaywgYyA9ICgtMy4xNDE1OTI2NTM1ODk3OTMyMzg0NjI2NDMzODMyNzk1MDI4ODQxOTcxNjkzOTkzNzUxMDU4MjAvbiksdDtcbiAgICB2YXIgYSA9IG51bWVyaWMucmVwKFttXSwwKSwgYiA9IG51bWVyaWMucmVwKFttXSwwKSxuaGFsZiA9IE1hdGguZmxvb3Iobi8yKTtcbiAgICBmb3Ioaz0wO2s8bjtrKyspIGFba10gPSB4W2tdO1xuICAgIGlmKHR5cGVvZiB5ICE9PSBcInVuZGVmaW5lZFwiKSBmb3Ioaz0wO2s8bjtrKyspIGJba10gPSB5W2tdO1xuICAgIGN4WzBdID0gMTtcbiAgICBmb3Ioaz0xO2s8PW0vMjtrKyspIHtcbiAgICAgICAgdCA9IGMqayprO1xuICAgICAgICBjeFtrXSA9IGNvcyh0KTtcbiAgICAgICAgY3lba10gPSBzaW4odCk7XG4gICAgICAgIGN4W20ta10gPSBjb3ModCk7XG4gICAgICAgIGN5W20ta10gPSBzaW4odClcbiAgICB9XG4gICAgdmFyIFggPSBuZXcgbnVtZXJpYy5UKGEsYiksIFkgPSBuZXcgbnVtZXJpYy5UKGN4LGN5KTtcbiAgICBYID0gWC5tdWwoWSk7XG4gICAgbnVtZXJpYy5jb252cG93MihYLngsWC55LG51bWVyaWMuY2xvbmUoWS54KSxudW1lcmljLm5lZyhZLnkpKTtcbiAgICBYID0gWC5tdWwoWSk7XG4gICAgWC54Lmxlbmd0aCA9IG47XG4gICAgWC55Lmxlbmd0aCA9IG47XG4gICAgcmV0dXJuIFg7XG59XG5udW1lcmljLlQucHJvdG90eXBlLmlmZnQgPSBmdW5jdGlvbiBpZmZ0KCkge1xuICAgIHZhciB4ID0gdGhpcy54LCB5ID0gdGhpcy55O1xuICAgIHZhciBuID0geC5sZW5ndGgsIGxvZyA9IE1hdGgubG9nLCBsb2cyID0gbG9nKDIpLFxuICAgICAgICBwID0gTWF0aC5jZWlsKGxvZygyKm4tMSkvbG9nMiksIG0gPSBNYXRoLnBvdygyLHApO1xuICAgIHZhciBjeCA9IG51bWVyaWMucmVwKFttXSwwKSwgY3kgPSBudW1lcmljLnJlcChbbV0sMCksIGNvcyA9IE1hdGguY29zLCBzaW4gPSBNYXRoLnNpbjtcbiAgICB2YXIgaywgYyA9ICgzLjE0MTU5MjY1MzU4OTc5MzIzODQ2MjY0MzM4MzI3OTUwMjg4NDE5NzE2OTM5OTM3NTEwNTgyMC9uKSx0O1xuICAgIHZhciBhID0gbnVtZXJpYy5yZXAoW21dLDApLCBiID0gbnVtZXJpYy5yZXAoW21dLDApLG5oYWxmID0gTWF0aC5mbG9vcihuLzIpO1xuICAgIGZvcihrPTA7azxuO2srKykgYVtrXSA9IHhba107XG4gICAgaWYodHlwZW9mIHkgIT09IFwidW5kZWZpbmVkXCIpIGZvcihrPTA7azxuO2srKykgYltrXSA9IHlba107XG4gICAgY3hbMF0gPSAxO1xuICAgIGZvcihrPTE7azw9bS8yO2srKykge1xuICAgICAgICB0ID0gYyprKms7XG4gICAgICAgIGN4W2tdID0gY29zKHQpO1xuICAgICAgICBjeVtrXSA9IHNpbih0KTtcbiAgICAgICAgY3hbbS1rXSA9IGNvcyh0KTtcbiAgICAgICAgY3lbbS1rXSA9IHNpbih0KVxuICAgIH1cbiAgICB2YXIgWCA9IG5ldyBudW1lcmljLlQoYSxiKSwgWSA9IG5ldyBudW1lcmljLlQoY3gsY3kpO1xuICAgIFggPSBYLm11bChZKTtcbiAgICBudW1lcmljLmNvbnZwb3cyKFgueCxYLnksbnVtZXJpYy5jbG9uZShZLngpLG51bWVyaWMubmVnKFkueSkpO1xuICAgIFggPSBYLm11bChZKTtcbiAgICBYLngubGVuZ3RoID0gbjtcbiAgICBYLnkubGVuZ3RoID0gbjtcbiAgICByZXR1cm4gWC5kaXYobik7XG59XG5cbi8vOS4gVW5jb25zdHJhaW5lZCBvcHRpbWl6YXRpb25cbm51bWVyaWMuZ3JhZGllbnQgPSBmdW5jdGlvbiBncmFkaWVudChmLHgpIHtcbiAgICB2YXIgbiA9IHgubGVuZ3RoO1xuICAgIHZhciBmMCA9IGYoeCk7XG4gICAgaWYoaXNOYU4oZjApKSB0aHJvdyBuZXcgRXJyb3IoJ2dyYWRpZW50OiBmKHgpIGlzIGEgTmFOIScpO1xuICAgIHZhciBtYXggPSBNYXRoLm1heDtcbiAgICB2YXIgaSx4MCA9IG51bWVyaWMuY2xvbmUoeCksZjEsZjIsIEogPSBBcnJheShuKTtcbiAgICB2YXIgZGl2ID0gbnVtZXJpYy5kaXYsIHN1YiA9IG51bWVyaWMuc3ViLGVycmVzdCxyb3VuZG9mZixtYXggPSBNYXRoLm1heCxlcHMgPSAxZS0zLGFicyA9IE1hdGguYWJzLCBtaW4gPSBNYXRoLm1pbjtcbiAgICB2YXIgdDAsdDEsdDIsaXQ9MCxkMSxkMixOO1xuICAgIGZvcihpPTA7aTxuO2krKykge1xuICAgICAgICB2YXIgaCA9IG1heCgxZS02KmYwLDFlLTgpO1xuICAgICAgICB3aGlsZSgxKSB7XG4gICAgICAgICAgICArK2l0O1xuICAgICAgICAgICAgaWYoaXQ+MjApIHsgdGhyb3cgbmV3IEVycm9yKFwiTnVtZXJpY2FsIGdyYWRpZW50IGZhaWxzXCIpOyB9XG4gICAgICAgICAgICB4MFtpXSA9IHhbaV0raDtcbiAgICAgICAgICAgIGYxID0gZih4MCk7XG4gICAgICAgICAgICB4MFtpXSA9IHhbaV0taDtcbiAgICAgICAgICAgIGYyID0gZih4MCk7XG4gICAgICAgICAgICB4MFtpXSA9IHhbaV07XG4gICAgICAgICAgICBpZihpc05hTihmMSkgfHwgaXNOYU4oZjIpKSB7IGgvPTE2OyBjb250aW51ZTsgfVxuICAgICAgICAgICAgSltpXSA9IChmMS1mMikvKDIqaCk7XG4gICAgICAgICAgICB0MCA9IHhbaV0taDtcbiAgICAgICAgICAgIHQxID0geFtpXTtcbiAgICAgICAgICAgIHQyID0geFtpXStoO1xuICAgICAgICAgICAgZDEgPSAoZjEtZjApL2g7XG4gICAgICAgICAgICBkMiA9IChmMC1mMikvaDtcbiAgICAgICAgICAgIE4gPSBtYXgoYWJzKEpbaV0pLGFicyhmMCksYWJzKGYxKSxhYnMoZjIpLGFicyh0MCksYWJzKHQxKSxhYnModDIpLDFlLTgpO1xuICAgICAgICAgICAgZXJyZXN0ID0gbWluKG1heChhYnMoZDEtSltpXSksYWJzKGQyLUpbaV0pLGFicyhkMS1kMikpL04saC9OKTtcbiAgICAgICAgICAgIGlmKGVycmVzdD5lcHMpIHsgaC89MTY7IH1cbiAgICAgICAgICAgIGVsc2UgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBKO1xufVxuXG5udW1lcmljLnVuY21pbiA9IGZ1bmN0aW9uIHVuY21pbihmLHgwLHRvbCxncmFkaWVudCxtYXhpdCxjYWxsYmFjayxvcHRpb25zKSB7XG4gICAgdmFyIGdyYWQgPSBudW1lcmljLmdyYWRpZW50O1xuICAgIGlmKHR5cGVvZiBvcHRpb25zID09PSBcInVuZGVmaW5lZFwiKSB7IG9wdGlvbnMgPSB7fTsgfVxuICAgIGlmKHR5cGVvZiB0b2wgPT09IFwidW5kZWZpbmVkXCIpIHsgdG9sID0gMWUtODsgfVxuICAgIGlmKHR5cGVvZiBncmFkaWVudCA9PT0gXCJ1bmRlZmluZWRcIikgeyBncmFkaWVudCA9IGZ1bmN0aW9uKHgpIHsgcmV0dXJuIGdyYWQoZix4KTsgfTsgfVxuICAgIGlmKHR5cGVvZiBtYXhpdCA9PT0gXCJ1bmRlZmluZWRcIikgbWF4aXQgPSAxMDAwO1xuICAgIHgwID0gbnVtZXJpYy5jbG9uZSh4MCk7XG4gICAgdmFyIG4gPSB4MC5sZW5ndGg7XG4gICAgdmFyIGYwID0gZih4MCksZjEsZGYwO1xuICAgIGlmKGlzTmFOKGYwKSkgdGhyb3cgbmV3IEVycm9yKCd1bmNtaW46IGYoeDApIGlzIGEgTmFOIScpO1xuICAgIHZhciBtYXggPSBNYXRoLm1heCwgbm9ybTIgPSBudW1lcmljLm5vcm0yO1xuICAgIHRvbCA9IG1heCh0b2wsbnVtZXJpYy5lcHNpbG9uKTtcbiAgICB2YXIgc3RlcCxnMCxnMSxIMSA9IG9wdGlvbnMuSGludiB8fCBudW1lcmljLmlkZW50aXR5KG4pO1xuICAgIHZhciBkb3QgPSBudW1lcmljLmRvdCwgaW52ID0gbnVtZXJpYy5pbnYsIHN1YiA9IG51bWVyaWMuc3ViLCBhZGQgPSBudW1lcmljLmFkZCwgdGVuID0gbnVtZXJpYy50ZW5zb3IsIGRpdiA9IG51bWVyaWMuZGl2LCBtdWwgPSBudW1lcmljLm11bDtcbiAgICB2YXIgYWxsID0gbnVtZXJpYy5hbGwsIGlzZmluaXRlID0gbnVtZXJpYy5pc0Zpbml0ZSwgbmVnID0gbnVtZXJpYy5uZWc7XG4gICAgdmFyIGl0PTAsaSxzLHgxLHksSHksSHMseXMsaTAsdCxuc3RlcCx0MSx0MjtcbiAgICB2YXIgbXNnID0gXCJcIjtcbiAgICBnMCA9IGdyYWRpZW50KHgwKTtcbiAgICB3aGlsZShpdDxtYXhpdCkge1xuICAgICAgICBpZih0eXBlb2YgY2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikgeyBpZihjYWxsYmFjayhpdCx4MCxmMCxnMCxIMSkpIHsgbXNnID0gXCJDYWxsYmFjayByZXR1cm5lZCB0cnVlXCI7IGJyZWFrOyB9IH1cbiAgICAgICAgaWYoIWFsbChpc2Zpbml0ZShnMCkpKSB7IG1zZyA9IFwiR3JhZGllbnQgaGFzIEluZmluaXR5IG9yIE5hTlwiOyBicmVhazsgfVxuICAgICAgICBzdGVwID0gbmVnKGRvdChIMSxnMCkpO1xuICAgICAgICBpZighYWxsKGlzZmluaXRlKHN0ZXApKSkgeyBtc2cgPSBcIlNlYXJjaCBkaXJlY3Rpb24gaGFzIEluZmluaXR5IG9yIE5hTlwiOyBicmVhazsgfVxuICAgICAgICBuc3RlcCA9IG5vcm0yKHN0ZXApO1xuICAgICAgICBpZihuc3RlcCA8IHRvbCkgeyBtc2c9XCJOZXd0b24gc3RlcCBzbWFsbGVyIHRoYW4gdG9sXCI7IGJyZWFrOyB9XG4gICAgICAgIHQgPSAxO1xuICAgICAgICBkZjAgPSBkb3QoZzAsc3RlcCk7XG4gICAgICAgIC8vIGxpbmUgc2VhcmNoXG4gICAgICAgIHgxID0geDA7XG4gICAgICAgIHdoaWxlKGl0IDwgbWF4aXQpIHtcbiAgICAgICAgICAgIGlmKHQqbnN0ZXAgPCB0b2wpIHsgYnJlYWs7IH1cbiAgICAgICAgICAgIHMgPSBtdWwoc3RlcCx0KTtcbiAgICAgICAgICAgIHgxID0gYWRkKHgwLHMpO1xuICAgICAgICAgICAgZjEgPSBmKHgxKTtcbiAgICAgICAgICAgIGlmKGYxLWYwID49IDAuMSp0KmRmMCB8fCBpc05hTihmMSkpIHtcbiAgICAgICAgICAgICAgICB0ICo9IDAuNTtcbiAgICAgICAgICAgICAgICArK2l0O1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgaWYodCpuc3RlcCA8IHRvbCkgeyBtc2cgPSBcIkxpbmUgc2VhcmNoIHN0ZXAgc2l6ZSBzbWFsbGVyIHRoYW4gdG9sXCI7IGJyZWFrOyB9XG4gICAgICAgIGlmKGl0ID09PSBtYXhpdCkgeyBtc2cgPSBcIm1heGl0IHJlYWNoZWQgZHVyaW5nIGxpbmUgc2VhcmNoXCI7IGJyZWFrOyB9XG4gICAgICAgIGcxID0gZ3JhZGllbnQoeDEpO1xuICAgICAgICB5ID0gc3ViKGcxLGcwKTtcbiAgICAgICAgeXMgPSBkb3QoeSxzKTtcbiAgICAgICAgSHkgPSBkb3QoSDEseSk7XG4gICAgICAgIEgxID0gc3ViKGFkZChIMSxcbiAgICAgICAgICAgICAgICBtdWwoXG4gICAgICAgICAgICAgICAgICAgICAgICAoeXMrZG90KHksSHkpKS8oeXMqeXMpLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVuKHMscykgICAgKSksXG4gICAgICAgICAgICAgICAgZGl2KGFkZCh0ZW4oSHkscyksdGVuKHMsSHkpKSx5cykpO1xuICAgICAgICB4MCA9IHgxO1xuICAgICAgICBmMCA9IGYxO1xuICAgICAgICBnMCA9IGcxO1xuICAgICAgICArK2l0O1xuICAgIH1cbiAgICByZXR1cm4ge3NvbHV0aW9uOiB4MCwgZjogZjAsIGdyYWRpZW50OiBnMCwgaW52SGVzc2lhbjogSDEsIGl0ZXJhdGlvbnM6aXQsIG1lc3NhZ2U6IG1zZ307XG59XG5cbi8vIDEwLiBPZGUgc29sdmVyIChEb3JtYW5kLVByaW5jZSlcbm51bWVyaWMuRG9wcmkgPSBmdW5jdGlvbiBEb3ByaSh4LHksZix5bWlkLGl0ZXJhdGlvbnMsbXNnLGV2ZW50cykge1xuICAgIHRoaXMueCA9IHg7XG4gICAgdGhpcy55ID0geTtcbiAgICB0aGlzLmYgPSBmO1xuICAgIHRoaXMueW1pZCA9IHltaWQ7XG4gICAgdGhpcy5pdGVyYXRpb25zID0gaXRlcmF0aW9ucztcbiAgICB0aGlzLmV2ZW50cyA9IGV2ZW50cztcbiAgICB0aGlzLm1lc3NhZ2UgPSBtc2c7XG59XG5udW1lcmljLkRvcHJpLnByb3RvdHlwZS5fYXQgPSBmdW5jdGlvbiBfYXQoeGksaikge1xuICAgIGZ1bmN0aW9uIHNxcih4KSB7IHJldHVybiB4Kng7IH1cbiAgICB2YXIgc29sID0gdGhpcztcbiAgICB2YXIgeHMgPSBzb2wueDtcbiAgICB2YXIgeXMgPSBzb2wueTtcbiAgICB2YXIgazEgPSBzb2wuZjtcbiAgICB2YXIgeW1pZCA9IHNvbC55bWlkO1xuICAgIHZhciBuID0geHMubGVuZ3RoO1xuICAgIHZhciB4MCx4MSx4aCx5MCx5MSx5aCx4aTtcbiAgICB2YXIgZmxvb3IgPSBNYXRoLmZsb29yLGg7XG4gICAgdmFyIGMgPSAwLjU7XG4gICAgdmFyIGFkZCA9IG51bWVyaWMuYWRkLCBtdWwgPSBudW1lcmljLm11bCxzdWIgPSBudW1lcmljLnN1YiwgcCxxLHc7XG4gICAgeDAgPSB4c1tqXTtcbiAgICB4MSA9IHhzW2orMV07XG4gICAgeTAgPSB5c1tqXTtcbiAgICB5MSA9IHlzW2orMV07XG4gICAgaCAgPSB4MS14MDtcbiAgICB4aCA9IHgwK2MqaDtcbiAgICB5aCA9IHltaWRbal07XG4gICAgcCA9IHN1YihrMVtqICBdLG11bCh5MCwxLyh4MC14aCkrMi8oeDAteDEpKSk7XG4gICAgcSA9IHN1YihrMVtqKzFdLG11bCh5MSwxLyh4MS14aCkrMi8oeDEteDApKSk7XG4gICAgdyA9IFtzcXIoeGkgLSB4MSkgKiAoeGkgLSB4aCkgLyBzcXIoeDAgLSB4MSkgLyAoeDAgLSB4aCksXG4gICAgICAgICBzcXIoeGkgLSB4MCkgKiBzcXIoeGkgLSB4MSkgLyBzcXIoeDAgLSB4aCkgLyBzcXIoeDEgLSB4aCksXG4gICAgICAgICBzcXIoeGkgLSB4MCkgKiAoeGkgLSB4aCkgLyBzcXIoeDEgLSB4MCkgLyAoeDEgLSB4aCksXG4gICAgICAgICAoeGkgLSB4MCkgKiBzcXIoeGkgLSB4MSkgKiAoeGkgLSB4aCkgLyBzcXIoeDAteDEpIC8gKHgwIC0geGgpLFxuICAgICAgICAgKHhpIC0geDEpICogc3FyKHhpIC0geDApICogKHhpIC0geGgpIC8gc3FyKHgwLXgxKSAvICh4MSAtIHhoKV07XG4gICAgcmV0dXJuIGFkZChhZGQoYWRkKGFkZChtdWwoeTAsd1swXSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBtdWwoeWgsd1sxXSkpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbXVsKHkxLHdbMl0pKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG11bCggcCx3WzNdKSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBtdWwoIHEsd1s0XSkpO1xufVxubnVtZXJpYy5Eb3ByaS5wcm90b3R5cGUuYXQgPSBmdW5jdGlvbiBhdCh4KSB7XG4gICAgdmFyIGksaixrLGZsb29yID0gTWF0aC5mbG9vcjtcbiAgICBpZih0eXBlb2YgeCAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICB2YXIgbiA9IHgubGVuZ3RoLCByZXQgPSBBcnJheShuKTtcbiAgICAgICAgZm9yKGk9bi0xO2khPT0tMTstLWkpIHtcbiAgICAgICAgICAgIHJldFtpXSA9IHRoaXMuYXQoeFtpXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG4gICAgdmFyIHgwID0gdGhpcy54O1xuICAgIGkgPSAwOyBqID0geDAubGVuZ3RoLTE7XG4gICAgd2hpbGUoai1pPjEpIHtcbiAgICAgICAgayA9IGZsb29yKDAuNSooaStqKSk7XG4gICAgICAgIGlmKHgwW2tdIDw9IHgpIGkgPSBrO1xuICAgICAgICBlbHNlIGogPSBrO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fYXQoeCxpKTtcbn1cblxubnVtZXJpYy5kb3ByaSA9IGZ1bmN0aW9uIGRvcHJpKHgwLHgxLHkwLGYsdG9sLG1heGl0LGV2ZW50KSB7XG4gICAgaWYodHlwZW9mIHRvbCA9PT0gXCJ1bmRlZmluZWRcIikgeyB0b2wgPSAxZS02OyB9XG4gICAgaWYodHlwZW9mIG1heGl0ID09PSBcInVuZGVmaW5lZFwiKSB7IG1heGl0ID0gMTAwMDsgfVxuICAgIHZhciB4cyA9IFt4MF0sIHlzID0gW3kwXSwgazEgPSBbZih4MCx5MCldLCBrMixrMyxrNCxrNSxrNixrNywgeW1pZCA9IFtdO1xuICAgIHZhciBBMiA9IDEvNTtcbiAgICB2YXIgQTMgPSBbMy80MCw5LzQwXTtcbiAgICB2YXIgQTQgPSBbNDQvNDUsLTU2LzE1LDMyLzldO1xuICAgIHZhciBBNSA9IFsxOTM3Mi82NTYxLC0yNTM2MC8yMTg3LDY0NDQ4LzY1NjEsLTIxMi83MjldO1xuICAgIHZhciBBNiA9IFs5MDE3LzMxNjgsLTM1NS8zMyw0NjczMi81MjQ3LDQ5LzE3NiwtNTEwMy8xODY1Nl07XG4gICAgdmFyIGIgPSBbMzUvMzg0LDAsNTAwLzExMTMsMTI1LzE5MiwtMjE4Ny82Nzg0LDExLzg0XTtcbiAgICB2YXIgYm0gPSBbMC41KjYwMjUxOTI3NDMvMzAwODU1NTMxNTIsXG4gICAgICAgICAgICAgIDAsXG4gICAgICAgICAgICAgIDAuNSo1MTI1MjI5MjkyNS82NTQwMDgyMTU5OCxcbiAgICAgICAgICAgICAgMC41Ki0yNjkxODY4OTI1LzQ1MTI4MzI5NzI4LFxuICAgICAgICAgICAgICAwLjUqMTg3OTQwMzcyMDY3LzE1OTQ1MzQzMTcwNTYsXG4gICAgICAgICAgICAgIDAuNSotMTc3NjA5NDMzMS8xOTc0MzY0NDI1NixcbiAgICAgICAgICAgICAgMC41KjExMjM3MDk5LzIzNTA0MzM4NF07XG4gICAgdmFyIGMgPSBbMS81LDMvMTAsNC81LDgvOSwxLDFdO1xuICAgIHZhciBlID0gWy03MS81NzYwMCwwLDcxLzE2Njk1LC03MS8xOTIwLDE3MjUzLzMzOTIwMCwtMjIvNTI1LDEvNDBdO1xuICAgIHZhciBpID0gMCxlcixqO1xuICAgIHZhciBoID0gKHgxLXgwKS8xMDtcbiAgICB2YXIgaXQgPSAwO1xuICAgIHZhciBhZGQgPSBudW1lcmljLmFkZCwgbXVsID0gbnVtZXJpYy5tdWwsIHkxLGVyaW5mO1xuICAgIHZhciBtYXggPSBNYXRoLm1heCwgbWluID0gTWF0aC5taW4sIGFicyA9IE1hdGguYWJzLCBub3JtaW5mID0gbnVtZXJpYy5ub3JtaW5mLHBvdyA9IE1hdGgucG93O1xuICAgIHZhciBhbnkgPSBudW1lcmljLmFueSwgbHQgPSBudW1lcmljLmx0LCBhbmQgPSBudW1lcmljLmFuZCwgc3ViID0gbnVtZXJpYy5zdWI7XG4gICAgdmFyIGUwLCBlMSwgZXY7XG4gICAgdmFyIHJldCA9IG5ldyBudW1lcmljLkRvcHJpKHhzLHlzLGsxLHltaWQsLTEsXCJcIik7XG4gICAgaWYodHlwZW9mIGV2ZW50ID09PSBcImZ1bmN0aW9uXCIpIGUwID0gZXZlbnQoeDAseTApO1xuICAgIHdoaWxlKHgwPHgxICYmIGl0PG1heGl0KSB7XG4gICAgICAgICsraXQ7XG4gICAgICAgIGlmKHgwK2g+eDEpIGggPSB4MS14MDtcbiAgICAgICAgazIgPSBmKHgwK2NbMF0qaCwgICAgICAgICAgICAgICAgYWRkKHkwLG11bCggICBBMipoLGsxW2ldKSkpO1xuICAgICAgICBrMyA9IGYoeDArY1sxXSpoLCAgICAgICAgICAgIGFkZChhZGQoeTAsbXVsKEEzWzBdKmgsazFbaV0pKSxtdWwoQTNbMV0qaCxrMikpKTtcbiAgICAgICAgazQgPSBmKHgwK2NbMl0qaCwgICAgICAgIGFkZChhZGQoYWRkKHkwLG11bChBNFswXSpoLGsxW2ldKSksbXVsKEE0WzFdKmgsazIpKSxtdWwoQTRbMl0qaCxrMykpKTtcbiAgICAgICAgazUgPSBmKHgwK2NbM10qaCwgICAgYWRkKGFkZChhZGQoYWRkKHkwLG11bChBNVswXSpoLGsxW2ldKSksbXVsKEE1WzFdKmgsazIpKSxtdWwoQTVbMl0qaCxrMykpLG11bChBNVszXSpoLGs0KSkpO1xuICAgICAgICBrNiA9IGYoeDArY1s0XSpoLGFkZChhZGQoYWRkKGFkZChhZGQoeTAsbXVsKEE2WzBdKmgsazFbaV0pKSxtdWwoQTZbMV0qaCxrMikpLG11bChBNlsyXSpoLGszKSksbXVsKEE2WzNdKmgsazQpKSxtdWwoQTZbNF0qaCxrNSkpKTtcbiAgICAgICAgeTEgPSBhZGQoYWRkKGFkZChhZGQoYWRkKHkwLG11bChrMVtpXSxoKmJbMF0pKSxtdWwoazMsaCpiWzJdKSksbXVsKGs0LGgqYlszXSkpLG11bChrNSxoKmJbNF0pKSxtdWwoazYsaCpiWzVdKSk7XG4gICAgICAgIGs3ID0gZih4MCtoLHkxKTtcbiAgICAgICAgZXIgPSBhZGQoYWRkKGFkZChhZGQoYWRkKG11bChrMVtpXSxoKmVbMF0pLG11bChrMyxoKmVbMl0pKSxtdWwoazQsaCplWzNdKSksbXVsKGs1LGgqZVs0XSkpLG11bChrNixoKmVbNV0pKSxtdWwoazcsaCplWzZdKSk7XG4gICAgICAgIGlmKHR5cGVvZiBlciA9PT0gXCJudW1iZXJcIikgZXJpbmYgPSBhYnMoZXIpO1xuICAgICAgICBlbHNlIGVyaW5mID0gbm9ybWluZihlcik7XG4gICAgICAgIGlmKGVyaW5mID4gdG9sKSB7IC8vIHJlamVjdFxuICAgICAgICAgICAgaCA9IDAuMipoKnBvdyh0b2wvZXJpbmYsMC4yNSk7XG4gICAgICAgICAgICBpZih4MCtoID09PSB4MCkge1xuICAgICAgICAgICAgICAgIHJldC5tc2cgPSBcIlN0ZXAgc2l6ZSBiZWNhbWUgdG9vIHNtYWxsXCI7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICB5bWlkW2ldID0gYWRkKGFkZChhZGQoYWRkKGFkZChhZGQoeTAsXG4gICAgICAgICAgICAgICAgbXVsKGsxW2ldLGgqYm1bMF0pKSxcbiAgICAgICAgICAgICAgICBtdWwoazMgICAsaCpibVsyXSkpLFxuICAgICAgICAgICAgICAgIG11bChrNCAgICxoKmJtWzNdKSksXG4gICAgICAgICAgICAgICAgbXVsKGs1ICAgLGgqYm1bNF0pKSxcbiAgICAgICAgICAgICAgICBtdWwoazYgICAsaCpibVs1XSkpLFxuICAgICAgICAgICAgICAgIG11bChrNyAgICxoKmJtWzZdKSk7XG4gICAgICAgICsraTtcbiAgICAgICAgeHNbaV0gPSB4MCtoO1xuICAgICAgICB5c1tpXSA9IHkxO1xuICAgICAgICBrMVtpXSA9IGs3O1xuICAgICAgICBpZih0eXBlb2YgZXZlbnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdmFyIHlpLHhsID0geDAseHIgPSB4MCswLjUqaCx4aTtcbiAgICAgICAgICAgIGUxID0gZXZlbnQoeHIseW1pZFtpLTFdKTtcbiAgICAgICAgICAgIGV2ID0gYW5kKGx0KGUwLDApLGx0KDAsZTEpKTtcbiAgICAgICAgICAgIGlmKCFhbnkoZXYpKSB7IHhsID0geHI7IHhyID0geDAraDsgZTAgPSBlMTsgZTEgPSBldmVudCh4cix5MSk7IGV2ID0gYW5kKGx0KGUwLDApLGx0KDAsZTEpKTsgfVxuICAgICAgICAgICAgaWYoYW55KGV2KSkge1xuICAgICAgICAgICAgICAgIHZhciB4YywgeWMsIGVuLGVpO1xuICAgICAgICAgICAgICAgIHZhciBzaWRlPTAsIHNsID0gMS4wLCBzciA9IDEuMDtcbiAgICAgICAgICAgICAgICB3aGlsZSgxKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBlMCA9PT0gXCJudW1iZXJcIikgeGkgPSAoc3IqZTEqeGwtc2wqZTAqeHIpLyhzciplMS1zbCplMCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgeGkgPSB4cjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcihqPWUwLmxlbmd0aC0xO2ohPT0tMTstLWopIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZihlMFtqXTwwICYmIGUxW2pdPjApIHhpID0gbWluKHhpLChzciplMVtqXSp4bC1zbCplMFtqXSp4cikvKHNyKmUxW2pdLXNsKmUwW2pdKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYoeGkgPD0geGwgfHwgeGkgPj0geHIpIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB5aSA9IHJldC5fYXQoeGksIGktMSk7XG4gICAgICAgICAgICAgICAgICAgIGVpID0gZXZlbnQoeGkseWkpO1xuICAgICAgICAgICAgICAgICAgICBlbiA9IGFuZChsdChlMCwwKSxsdCgwLGVpKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmKGFueShlbikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHhyID0geGk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlMSA9IGVpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZXYgPSBlbjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNyID0gMS4wO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYoc2lkZSA9PT0gLTEpIHNsICo9IDAuNTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Ugc2wgPSAxLjA7XG4gICAgICAgICAgICAgICAgICAgICAgICBzaWRlID0gLTE7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB4bCA9IHhpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZTAgPSBlaTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNsID0gMS4wO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYoc2lkZSA9PT0gMSkgc3IgKj0gMC41O1xuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzciA9IDEuMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpZGUgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHkxID0gcmV0Ll9hdCgwLjUqKHgwK3hpKSxpLTEpO1xuICAgICAgICAgICAgICAgIHJldC5mW2ldID0gZih4aSx5aSk7XG4gICAgICAgICAgICAgICAgcmV0LnhbaV0gPSB4aTtcbiAgICAgICAgICAgICAgICByZXQueVtpXSA9IHlpO1xuICAgICAgICAgICAgICAgIHJldC55bWlkW2ktMV0gPSB5MTtcbiAgICAgICAgICAgICAgICByZXQuZXZlbnRzID0gZXY7XG4gICAgICAgICAgICAgICAgcmV0Lml0ZXJhdGlvbnMgPSBpdDtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmV0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHgwICs9IGg7XG4gICAgICAgIHkwID0geTE7XG4gICAgICAgIGUwID0gZTE7XG4gICAgICAgIGggPSBtaW4oMC44KmgqcG93KHRvbC9lcmluZiwwLjI1KSw0KmgpO1xuICAgIH1cbiAgICByZXQuaXRlcmF0aW9ucyA9IGl0O1xuICAgIHJldHVybiByZXQ7XG59XG5cbi8vIDExLiBBeCA9IGJcbm51bWVyaWMuTFUgPSBmdW5jdGlvbihBLCBmYXN0KSB7XG4gIGZhc3QgPSBmYXN0IHx8IGZhbHNlO1xuXG4gIHZhciBhYnMgPSBNYXRoLmFicztcbiAgdmFyIGksIGosIGssIGFic0FqaywgQWtrLCBBaywgUGssIEFpO1xuICB2YXIgbWF4O1xuICB2YXIgbiA9IEEubGVuZ3RoLCBuMSA9IG4tMTtcbiAgdmFyIFAgPSBuZXcgQXJyYXkobik7XG4gIGlmKCFmYXN0KSBBID0gbnVtZXJpYy5jbG9uZShBKTtcblxuICBmb3IgKGsgPSAwOyBrIDwgbjsgKytrKSB7XG4gICAgUGsgPSBrO1xuICAgIEFrID0gQVtrXTtcbiAgICBtYXggPSBhYnMoQWtba10pO1xuICAgIGZvciAoaiA9IGsgKyAxOyBqIDwgbjsgKytqKSB7XG4gICAgICBhYnNBamsgPSBhYnMoQVtqXVtrXSk7XG4gICAgICBpZiAobWF4IDwgYWJzQWprKSB7XG4gICAgICAgIG1heCA9IGFic0FqaztcbiAgICAgICAgUGsgPSBqO1xuICAgICAgfVxuICAgIH1cbiAgICBQW2tdID0gUGs7XG5cbiAgICBpZiAoUGsgIT0gaykge1xuICAgICAgQVtrXSA9IEFbUGtdO1xuICAgICAgQVtQa10gPSBBaztcbiAgICAgIEFrID0gQVtrXTtcbiAgICB9XG5cbiAgICBBa2sgPSBBa1trXTtcblxuICAgIGZvciAoaSA9IGsgKyAxOyBpIDwgbjsgKytpKSB7XG4gICAgICBBW2ldW2tdIC89IEFraztcbiAgICB9XG5cbiAgICBmb3IgKGkgPSBrICsgMTsgaSA8IG47ICsraSkge1xuICAgICAgQWkgPSBBW2ldO1xuICAgICAgZm9yIChqID0gayArIDE7IGogPCBuMTsgKytqKSB7XG4gICAgICAgIEFpW2pdIC09IEFpW2tdICogQWtbal07XG4gICAgICAgICsrajtcbiAgICAgICAgQWlbal0gLT0gQWlba10gKiBBa1tqXTtcbiAgICAgIH1cbiAgICAgIGlmKGo9PT1uMSkgQWlbal0gLT0gQWlba10gKiBBa1tqXTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIExVOiBBLFxuICAgIFA6ICBQXG4gIH07XG59XG5cbm51bWVyaWMuTFVzb2x2ZSA9IGZ1bmN0aW9uIExVc29sdmUoTFVQLCBiKSB7XG4gIHZhciBpLCBqO1xuICB2YXIgTFUgPSBMVVAuTFU7XG4gIHZhciBuICAgPSBMVS5sZW5ndGg7XG4gIHZhciB4ID0gbnVtZXJpYy5jbG9uZShiKTtcbiAgdmFyIFAgICA9IExVUC5QO1xuICB2YXIgUGksIExVaSwgTFVpaSwgdG1wO1xuXG4gIGZvciAoaT1uLTE7aSE9PS0xOy0taSkgeFtpXSA9IGJbaV07XG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICBQaSA9IFBbaV07XG4gICAgaWYgKFBbaV0gIT09IGkpIHtcbiAgICAgIHRtcCA9IHhbaV07XG4gICAgICB4W2ldID0geFtQaV07XG4gICAgICB4W1BpXSA9IHRtcDtcbiAgICB9XG5cbiAgICBMVWkgPSBMVVtpXTtcbiAgICBmb3IgKGogPSAwOyBqIDwgaTsgKytqKSB7XG4gICAgICB4W2ldIC09IHhbal0gKiBMVWlbal07XG4gICAgfVxuICB9XG5cbiAgZm9yIChpID0gbiAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgTFVpID0gTFVbaV07XG4gICAgZm9yIChqID0gaSArIDE7IGogPCBuOyArK2opIHtcbiAgICAgIHhbaV0gLT0geFtqXSAqIExVaVtqXTtcbiAgICB9XG5cbiAgICB4W2ldIC89IExVaVtpXTtcbiAgfVxuXG4gIHJldHVybiB4O1xufVxuXG5udW1lcmljLnNvbHZlID0gZnVuY3Rpb24gc29sdmUoQSxiLGZhc3QpIHsgcmV0dXJuIG51bWVyaWMuTFVzb2x2ZShudW1lcmljLkxVKEEsZmFzdCksIGIpOyB9XG5cbi8vIDEyLiBMaW5lYXIgcHJvZ3JhbW1pbmdcbm51bWVyaWMuZWNoZWxvbml6ZSA9IGZ1bmN0aW9uIGVjaGVsb25pemUoQSkge1xuICAgIHZhciBzID0gbnVtZXJpYy5kaW0oQSksIG0gPSBzWzBdLCBuID0gc1sxXTtcbiAgICB2YXIgSSA9IG51bWVyaWMuaWRlbnRpdHkobSk7XG4gICAgdmFyIFAgPSBBcnJheShtKTtcbiAgICB2YXIgaSxqLGssbCxBaSxJaSxaLGE7XG4gICAgdmFyIGFicyA9IE1hdGguYWJzO1xuICAgIHZhciBkaXZlcSA9IG51bWVyaWMuZGl2ZXE7XG4gICAgQSA9IG51bWVyaWMuY2xvbmUoQSk7XG4gICAgZm9yKGk9MDtpPG07KytpKSB7XG4gICAgICAgIGsgPSAwO1xuICAgICAgICBBaSA9IEFbaV07XG4gICAgICAgIElpID0gSVtpXTtcbiAgICAgICAgZm9yKGo9MTtqPG47KytqKSBpZihhYnMoQWlba10pPGFicyhBaVtqXSkpIGs9ajtcbiAgICAgICAgUFtpXSA9IGs7XG4gICAgICAgIGRpdmVxKElpLEFpW2tdKTtcbiAgICAgICAgZGl2ZXEoQWksQWlba10pO1xuICAgICAgICBmb3Ioaj0wO2o8bTsrK2opIGlmKGohPT1pKSB7XG4gICAgICAgICAgICBaID0gQVtqXTsgYSA9IFpba107XG4gICAgICAgICAgICBmb3IobD1uLTE7bCE9PS0xOy0tbCkgWltsXSAtPSBBaVtsXSphO1xuICAgICAgICAgICAgWiA9IElbal07XG4gICAgICAgICAgICBmb3IobD1tLTE7bCE9PS0xOy0tbCkgWltsXSAtPSBJaVtsXSphO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7STpJLCBBOkEsIFA6UH07XG59XG5cbm51bWVyaWMuX19zb2x2ZUxQID0gZnVuY3Rpb24gX19zb2x2ZUxQKGMsQSxiLHRvbCxtYXhpdCx4LGZsYWcpIHtcbiAgICB2YXIgc3VtID0gbnVtZXJpYy5zdW0sIGxvZyA9IG51bWVyaWMubG9nLCBtdWwgPSBudW1lcmljLm11bCwgc3ViID0gbnVtZXJpYy5zdWIsIGRvdCA9IG51bWVyaWMuZG90LCBkaXYgPSBudW1lcmljLmRpdiwgYWRkID0gbnVtZXJpYy5hZGQ7XG4gICAgdmFyIG0gPSBjLmxlbmd0aCwgbiA9IGIubGVuZ3RoLHk7XG4gICAgdmFyIHVuYm91bmRlZCA9IGZhbHNlLCBjYixpMD0wO1xuICAgIHZhciBhbHBoYSA9IDEuMDtcbiAgICB2YXIgZjAsZGYwLEFUID0gbnVtZXJpYy50cmFuc3Bvc2UoQSksIHN2ZCA9IG51bWVyaWMuc3ZkLHRyYW5zcG9zZSA9IG51bWVyaWMudHJhbnNwb3NlLGxlcSA9IG51bWVyaWMubGVxLCBzcXJ0ID0gTWF0aC5zcXJ0LCBhYnMgPSBNYXRoLmFicztcbiAgICB2YXIgbXVsZXEgPSBudW1lcmljLm11bGVxO1xuICAgIHZhciBub3JtID0gbnVtZXJpYy5ub3JtaW5mLCBhbnkgPSBudW1lcmljLmFueSxtaW4gPSBNYXRoLm1pbjtcbiAgICB2YXIgYWxsID0gbnVtZXJpYy5hbGwsIGd0ID0gbnVtZXJpYy5ndDtcbiAgICB2YXIgcCA9IEFycmF5KG0pLCBBMCA9IEFycmF5KG4pLGU9bnVtZXJpYy5yZXAoW25dLDEpLCBIO1xuICAgIHZhciBzb2x2ZSA9IG51bWVyaWMuc29sdmUsIHogPSBzdWIoYixkb3QoQSx4KSksY291bnQ7XG4gICAgdmFyIGRvdGNjID0gZG90KGMsYyk7XG4gICAgdmFyIGc7XG4gICAgZm9yKGNvdW50PWkwO2NvdW50PG1heGl0OysrY291bnQpIHtcbiAgICAgICAgdmFyIGksaixkO1xuICAgICAgICBmb3IoaT1uLTE7aSE9PS0xOy0taSkgQTBbaV0gPSBkaXYoQVtpXSx6W2ldKTtcbiAgICAgICAgdmFyIEExID0gdHJhbnNwb3NlKEEwKTtcbiAgICAgICAgZm9yKGk9bS0xO2khPT0tMTstLWkpIHBbaV0gPSAoLyp4W2ldKyovc3VtKEExW2ldKSk7XG4gICAgICAgIGFscGhhID0gMC4yNSphYnMoZG90Y2MvZG90KGMscCkpO1xuICAgICAgICB2YXIgYTEgPSAxMDAqc3FydChkb3RjYy9kb3QocCxwKSk7XG4gICAgICAgIGlmKCFpc0Zpbml0ZShhbHBoYSkgfHwgYWxwaGE+YTEpIGFscGhhID0gYTE7XG4gICAgICAgIGcgPSBhZGQoYyxtdWwoYWxwaGEscCkpO1xuICAgICAgICBIID0gZG90KEExLEEwKTtcbiAgICAgICAgZm9yKGk9bS0xO2khPT0tMTstLWkpIEhbaV1baV0gKz0gMTtcbiAgICAgICAgZCA9IHNvbHZlKEgsZGl2KGcsYWxwaGEpLHRydWUpO1xuICAgICAgICB2YXIgdDAgPSBkaXYoeixkb3QoQSxkKSk7XG4gICAgICAgIHZhciB0ID0gMS4wO1xuICAgICAgICBmb3IoaT1uLTE7aSE9PS0xOy0taSkgaWYodDBbaV08MCkgdCA9IG1pbih0LC0wLjk5OSp0MFtpXSk7XG4gICAgICAgIHkgPSBzdWIoeCxtdWwoZCx0KSk7XG4gICAgICAgIHogPSBzdWIoYixkb3QoQSx5KSk7XG4gICAgICAgIGlmKCFhbGwoZ3QoeiwwKSkpIHJldHVybiB7IHNvbHV0aW9uOiB4LCBtZXNzYWdlOiBcIlwiLCBpdGVyYXRpb25zOiBjb3VudCB9O1xuICAgICAgICB4ID0geTtcbiAgICAgICAgaWYoYWxwaGE8dG9sKSByZXR1cm4geyBzb2x1dGlvbjogeSwgbWVzc2FnZTogXCJcIiwgaXRlcmF0aW9uczogY291bnQgfTtcbiAgICAgICAgaWYoZmxhZykge1xuICAgICAgICAgICAgdmFyIHMgPSBkb3QoYyxnKSwgQWcgPSBkb3QoQSxnKTtcbiAgICAgICAgICAgIHVuYm91bmRlZCA9IHRydWU7XG4gICAgICAgICAgICBmb3IoaT1uLTE7aSE9PS0xOy0taSkgaWYocypBZ1tpXTwwKSB7IHVuYm91bmRlZCA9IGZhbHNlOyBicmVhazsgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYoeFttLTFdPj0wKSB1bmJvdW5kZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGVsc2UgdW5ib3VuZGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZih1bmJvdW5kZWQpIHJldHVybiB7IHNvbHV0aW9uOiB5LCBtZXNzYWdlOiBcIlVuYm91bmRlZFwiLCBpdGVyYXRpb25zOiBjb3VudCB9O1xuICAgIH1cbiAgICByZXR1cm4geyBzb2x1dGlvbjogeCwgbWVzc2FnZTogXCJtYXhpbXVtIGl0ZXJhdGlvbiBjb3VudCBleGNlZWRlZFwiLCBpdGVyYXRpb25zOmNvdW50IH07XG59XG5cbm51bWVyaWMuX3NvbHZlTFAgPSBmdW5jdGlvbiBfc29sdmVMUChjLEEsYix0b2wsbWF4aXQpIHtcbiAgICB2YXIgbSA9IGMubGVuZ3RoLCBuID0gYi5sZW5ndGgseTtcbiAgICB2YXIgc3VtID0gbnVtZXJpYy5zdW0sIGxvZyA9IG51bWVyaWMubG9nLCBtdWwgPSBudW1lcmljLm11bCwgc3ViID0gbnVtZXJpYy5zdWIsIGRvdCA9IG51bWVyaWMuZG90LCBkaXYgPSBudW1lcmljLmRpdiwgYWRkID0gbnVtZXJpYy5hZGQ7XG4gICAgdmFyIGMwID0gbnVtZXJpYy5yZXAoW21dLDApLmNvbmNhdChbMV0pO1xuICAgIHZhciBKID0gbnVtZXJpYy5yZXAoW24sMV0sLTEpO1xuICAgIHZhciBBMCA9IG51bWVyaWMuYmxvY2tNYXRyaXgoW1tBICAgICAgICAgICAgICAgICAgICwgICBKICBdXSk7XG4gICAgdmFyIGIwID0gYjtcbiAgICB2YXIgeSA9IG51bWVyaWMucmVwKFttXSwwKS5jb25jYXQoTWF0aC5tYXgoMCxudW1lcmljLnN1cChudW1lcmljLm5lZyhiKSkpKzEpO1xuICAgIHZhciB4MCA9IG51bWVyaWMuX19zb2x2ZUxQKGMwLEEwLGIwLHRvbCxtYXhpdCx5LGZhbHNlKTtcbiAgICB2YXIgeCA9IG51bWVyaWMuY2xvbmUoeDAuc29sdXRpb24pO1xuICAgIHgubGVuZ3RoID0gbTtcbiAgICB2YXIgZm9vID0gbnVtZXJpYy5pbmYoc3ViKGIsZG90KEEseCkpKTtcbiAgICBpZihmb288MCkgeyByZXR1cm4geyBzb2x1dGlvbjogTmFOLCBtZXNzYWdlOiBcIkluZmVhc2libGVcIiwgaXRlcmF0aW9uczogeDAuaXRlcmF0aW9ucyB9OyB9XG4gICAgdmFyIHJldCA9IG51bWVyaWMuX19zb2x2ZUxQKGMsIEEsIGIsIHRvbCwgbWF4aXQteDAuaXRlcmF0aW9ucywgeCwgdHJ1ZSk7XG4gICAgcmV0Lml0ZXJhdGlvbnMgKz0geDAuaXRlcmF0aW9ucztcbiAgICByZXR1cm4gcmV0O1xufTtcblxubnVtZXJpYy5zb2x2ZUxQID0gZnVuY3Rpb24gc29sdmVMUChjLEEsYixBZXEsYmVxLHRvbCxtYXhpdCkge1xuICAgIGlmKHR5cGVvZiBtYXhpdCA9PT0gXCJ1bmRlZmluZWRcIikgbWF4aXQgPSAxMDAwO1xuICAgIGlmKHR5cGVvZiB0b2wgPT09IFwidW5kZWZpbmVkXCIpIHRvbCA9IG51bWVyaWMuZXBzaWxvbjtcbiAgICBpZih0eXBlb2YgQWVxID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVtZXJpYy5fc29sdmVMUChjLEEsYix0b2wsbWF4aXQpO1xuICAgIHZhciBtID0gQWVxLmxlbmd0aCwgbiA9IEFlcVswXS5sZW5ndGgsIG8gPSBBLmxlbmd0aDtcbiAgICB2YXIgQiA9IG51bWVyaWMuZWNoZWxvbml6ZShBZXEpO1xuICAgIHZhciBmbGFncyA9IG51bWVyaWMucmVwKFtuXSwwKTtcbiAgICB2YXIgUCA9IEIuUDtcbiAgICB2YXIgUSA9IFtdO1xuICAgIHZhciBpO1xuICAgIGZvcihpPVAubGVuZ3RoLTE7aSE9PS0xOy0taSkgZmxhZ3NbUFtpXV0gPSAxO1xuICAgIGZvcihpPW4tMTtpIT09LTE7LS1pKSBpZihmbGFnc1tpXT09PTApIFEucHVzaChpKTtcbiAgICB2YXIgZyA9IG51bWVyaWMuZ2V0UmFuZ2U7XG4gICAgdmFyIEkgPSBudW1lcmljLmxpbnNwYWNlKDAsbS0xKSwgSiA9IG51bWVyaWMubGluc3BhY2UoMCxvLTEpO1xuICAgIHZhciBBZXEyID0gZyhBZXEsSSxRKSwgQTEgPSBnKEEsSixQKSwgQTIgPSBnKEEsSixRKSwgZG90ID0gbnVtZXJpYy5kb3QsIHN1YiA9IG51bWVyaWMuc3ViO1xuICAgIHZhciBBMyA9IGRvdChBMSxCLkkpO1xuICAgIHZhciBBNCA9IHN1YihBMixkb3QoQTMsQWVxMikpLCBiNCA9IHN1YihiLGRvdChBMyxiZXEpKTtcbiAgICB2YXIgYzEgPSBBcnJheShQLmxlbmd0aCksIGMyID0gQXJyYXkoUS5sZW5ndGgpO1xuICAgIGZvcihpPVAubGVuZ3RoLTE7aSE9PS0xOy0taSkgYzFbaV0gPSBjW1BbaV1dO1xuICAgIGZvcihpPVEubGVuZ3RoLTE7aSE9PS0xOy0taSkgYzJbaV0gPSBjW1FbaV1dO1xuICAgIHZhciBjNCA9IHN1YihjMixkb3QoYzEsZG90KEIuSSxBZXEyKSkpO1xuICAgIHZhciBTID0gbnVtZXJpYy5fc29sdmVMUChjNCxBNCxiNCx0b2wsbWF4aXQpO1xuICAgIHZhciB4MiA9IFMuc29sdXRpb247XG4gICAgaWYoeDIhPT14MikgcmV0dXJuIFM7XG4gICAgdmFyIHgxID0gZG90KEIuSSxzdWIoYmVxLGRvdChBZXEyLHgyKSkpO1xuICAgIHZhciB4ID0gQXJyYXkoYy5sZW5ndGgpO1xuICAgIGZvcihpPVAubGVuZ3RoLTE7aSE9PS0xOy0taSkgeFtQW2ldXSA9IHgxW2ldO1xuICAgIGZvcihpPVEubGVuZ3RoLTE7aSE9PS0xOy0taSkgeFtRW2ldXSA9IHgyW2ldO1xuICAgIHJldHVybiB7IHNvbHV0aW9uOiB4LCBtZXNzYWdlOlMubWVzc2FnZSwgaXRlcmF0aW9uczogUy5pdGVyYXRpb25zIH07XG59XG5cbm51bWVyaWMuTVBTdG9MUCA9IGZ1bmN0aW9uIE1QU3RvTFAoTVBTKSB7XG4gICAgaWYoTVBTIGluc3RhbmNlb2YgU3RyaW5nKSB7IE1QUy5zcGxpdCgnXFxuJyk7IH1cbiAgICB2YXIgc3RhdGUgPSAwO1xuICAgIHZhciBzdGF0ZXMgPSBbJ0luaXRpYWwgc3RhdGUnLCdOQU1FJywnUk9XUycsJ0NPTFVNTlMnLCdSSFMnLCdCT1VORFMnLCdFTkRBVEEnXTtcbiAgICB2YXIgbiA9IE1QUy5sZW5ndGg7XG4gICAgdmFyIGksaix6LE49MCxyb3dzID0ge30sIHNpZ24gPSBbXSwgcmwgPSAwLCB2YXJzID0ge30sIG52ID0gMDtcbiAgICB2YXIgbmFtZTtcbiAgICB2YXIgYyA9IFtdLCBBID0gW10sIGIgPSBbXTtcbiAgICBmdW5jdGlvbiBlcnIoZSkgeyB0aHJvdyBuZXcgRXJyb3IoJ01QU3RvTFA6ICcrZSsnXFxuTGluZSAnK2krJzogJytNUFNbaV0rJ1xcbkN1cnJlbnQgc3RhdGU6ICcrc3RhdGVzW3N0YXRlXSsnXFxuJyk7IH1cbiAgICBmb3IoaT0wO2k8bjsrK2kpIHtcbiAgICAgICAgeiA9IE1QU1tpXTtcbiAgICAgICAgdmFyIHcwID0gei5tYXRjaCgvXFxTKi9nKTtcbiAgICAgICAgdmFyIHcgPSBbXTtcbiAgICAgICAgZm9yKGo9MDtqPHcwLmxlbmd0aDsrK2opIGlmKHcwW2pdIT09XCJcIikgdy5wdXNoKHcwW2pdKTtcbiAgICAgICAgaWYody5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICBmb3Ioaj0wO2o8c3RhdGVzLmxlbmd0aDsrK2opIGlmKHouc3Vic3RyKDAsc3RhdGVzW2pdLmxlbmd0aCkgPT09IHN0YXRlc1tqXSkgYnJlYWs7XG4gICAgICAgIGlmKGo8c3RhdGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgc3RhdGUgPSBqO1xuICAgICAgICAgICAgaWYoaj09PTEpIHsgbmFtZSA9IHdbMV07IH1cbiAgICAgICAgICAgIGlmKGo9PT02KSByZXR1cm4geyBuYW1lOm5hbWUsIGM6YywgQTpudW1lcmljLnRyYW5zcG9zZShBKSwgYjpiLCByb3dzOnJvd3MsIHZhcnM6dmFycyB9O1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgc3dpdGNoKHN0YXRlKSB7XG4gICAgICAgIGNhc2UgMDogY2FzZSAxOiBlcnIoJ1VuZXhwZWN0ZWQgbGluZScpO1xuICAgICAgICBjYXNlIDI6IFxuICAgICAgICAgICAgc3dpdGNoKHdbMF0pIHtcbiAgICAgICAgICAgIGNhc2UgJ04nOiBpZihOPT09MCkgTiA9IHdbMV07IGVsc2UgZXJyKCdUd28gb3IgbW9yZSBOIHJvd3MnKTsgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdMJzogcm93c1t3WzFdXSA9IHJsOyBzaWduW3JsXSA9IDE7IGJbcmxdID0gMDsgKytybDsgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdHJzogcm93c1t3WzFdXSA9IHJsOyBzaWduW3JsXSA9IC0xO2JbcmxdID0gMDsgKytybDsgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdFJzogcm93c1t3WzFdXSA9IHJsOyBzaWduW3JsXSA9IDA7YltybF0gPSAwOyArK3JsOyBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6IGVycignUGFyc2UgZXJyb3IgJytudW1lcmljLnByZXR0eVByaW50KHcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDM6XG4gICAgICAgICAgICBpZighdmFycy5oYXNPd25Qcm9wZXJ0eSh3WzBdKSkgeyB2YXJzW3dbMF1dID0gbnY7IGNbbnZdID0gMDsgQVtudl0gPSBudW1lcmljLnJlcChbcmxdLDApOyArK252OyB9XG4gICAgICAgICAgICB2YXIgcCA9IHZhcnNbd1swXV07XG4gICAgICAgICAgICBmb3Ioaj0xO2o8dy5sZW5ndGg7ais9Mikge1xuICAgICAgICAgICAgICAgIGlmKHdbal0gPT09IE4pIHsgY1twXSA9IHBhcnNlRmxvYXQod1tqKzFdKTsgY29udGludWU7IH1cbiAgICAgICAgICAgICAgICB2YXIgcSA9IHJvd3Nbd1tqXV07XG4gICAgICAgICAgICAgICAgQVtwXVtxXSA9IChzaWduW3FdPDA/LTE6MSkqcGFyc2VGbG9hdCh3W2orMV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgNDpcbiAgICAgICAgICAgIGZvcihqPTE7ajx3Lmxlbmd0aDtqKz0yKSBiW3Jvd3Nbd1tqXV1dID0gKHNpZ25bcm93c1t3W2pdXV08MD8tMToxKSpwYXJzZUZsb2F0KHdbaisxXSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSA1OiAvKkZJWE1FKi8gYnJlYWs7XG4gICAgICAgIGNhc2UgNjogZXJyKCdJbnRlcm5hbCBlcnJvcicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVycignUmVhY2hlZCBlbmQgb2YgZmlsZSB3aXRob3V0IEVOREFUQScpO1xufVxuLy8gc2VlZHJhbmRvbS5qcyB2ZXJzaW9uIDIuMC5cbi8vIEF1dGhvcjogRGF2aWQgQmF1IDQvMi8yMDExXG4vL1xuLy8gRGVmaW5lcyBhIG1ldGhvZCBNYXRoLnNlZWRyYW5kb20oKSB0aGF0LCB3aGVuIGNhbGxlZCwgc3Vic3RpdHV0ZXNcbi8vIGFuIGV4cGxpY2l0bHkgc2VlZGVkIFJDNC1iYXNlZCBhbGdvcml0aG0gZm9yIE1hdGgucmFuZG9tKCkuICBBbHNvXG4vLyBzdXBwb3J0cyBhdXRvbWF0aWMgc2VlZGluZyBmcm9tIGxvY2FsIG9yIG5ldHdvcmsgc291cmNlcyBvZiBlbnRyb3B5LlxuLy9cbi8vIFVzYWdlOlxuLy9cbi8vICAgPHNjcmlwdCBzcmM9aHR0cDovL2RhdmlkYmF1LmNvbS9lbmNvZGUvc2VlZHJhbmRvbS1taW4uanM+PC9zY3JpcHQ+XG4vL1xuLy8gICBNYXRoLnNlZWRyYW5kb20oJ3lpcGVlJyk7IFNldHMgTWF0aC5yYW5kb20gdG8gYSBmdW5jdGlvbiB0aGF0IGlzXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5pdGlhbGl6ZWQgdXNpbmcgdGhlIGdpdmVuIGV4cGxpY2l0IHNlZWQuXG4vL1xuLy8gICBNYXRoLnNlZWRyYW5kb20oKTsgICAgICAgIFNldHMgTWF0aC5yYW5kb20gdG8gYSBmdW5jdGlvbiB0aGF0IGlzXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VlZGVkIHVzaW5nIHRoZSBjdXJyZW50IHRpbWUsIGRvbSBzdGF0ZSxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbmQgb3RoZXIgYWNjdW11bGF0ZWQgbG9jYWwgZW50cm9weS5cbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGUgZ2VuZXJhdGVkIHNlZWQgc3RyaW5nIGlzIHJldHVybmVkLlxuLy9cbi8vICAgTWF0aC5zZWVkcmFuZG9tKCd5b3d6YScsIHRydWUpO1xuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNlZWRzIHVzaW5nIHRoZSBnaXZlbiBleHBsaWNpdCBzZWVkIG1peGVkXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9nZXRoZXIgd2l0aCBhY2N1bXVsYXRlZCBlbnRyb3B5LlxuLy9cbi8vICAgPHNjcmlwdCBzcmM9XCJodHRwOi8vYml0Lmx5L3NyYW5kb20tNTEyXCI+PC9zY3JpcHQ+XG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgU2VlZHMgdXNpbmcgcGh5c2ljYWwgcmFuZG9tIGJpdHMgZG93bmxvYWRlZFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZyb20gcmFuZG9tLm9yZy5cbi8vXG4vLyAgIDxzY3JpcHQgc3JjPVwiaHR0cHM6Ly9qc29ubGliLmFwcHNwb3QuY29tL3VyYW5kb20/Y2FsbGJhY2s9TWF0aC5zZWVkcmFuZG9tXCI+XG4vLyAgIDwvc2NyaXB0PiAgICAgICAgICAgICAgICAgU2VlZHMgdXNpbmcgdXJhbmRvbSBiaXRzIGZyb20gY2FsbC5qc29ubGliLmNvbSxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aGljaCBpcyBmYXN0ZXIgdGhhbiByYW5kb20ub3JnLlxuLy9cbi8vIEV4YW1wbGVzOlxuLy9cbi8vICAgTWF0aC5zZWVkcmFuZG9tKFwiaGVsbG9cIik7ICAgICAgICAgICAgLy8gVXNlIFwiaGVsbG9cIiBhcyB0aGUgc2VlZC5cbi8vICAgZG9jdW1lbnQud3JpdGUoTWF0aC5yYW5kb20oKSk7ICAgICAgIC8vIEFsd2F5cyAwLjU0NjM2NjM3NjgxNDA3MzRcbi8vICAgZG9jdW1lbnQud3JpdGUoTWF0aC5yYW5kb20oKSk7ICAgICAgIC8vIEFsd2F5cyAwLjQzOTczNzkzNzcwNTkyMjM0XG4vLyAgIHZhciBybmcxID0gTWF0aC5yYW5kb207ICAgICAgICAgICAgICAvLyBSZW1lbWJlciB0aGUgY3VycmVudCBwcm5nLlxuLy9cbi8vICAgdmFyIGF1dG9zZWVkID0gTWF0aC5zZWVkcmFuZG9tKCk7ICAgIC8vIE5ldyBwcm5nIHdpdGggYW4gYXV0b21hdGljIHNlZWQuXG4vLyAgIGRvY3VtZW50LndyaXRlKE1hdGgucmFuZG9tKCkpOyAgICAgICAvLyBQcmV0dHkgbXVjaCB1bnByZWRpY3RhYmxlLlxuLy9cbi8vICAgTWF0aC5yYW5kb20gPSBybmcxOyAgICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIFwiaGVsbG9cIiBwcm5nIHNlcXVlbmNlLlxuLy8gICBkb2N1bWVudC53cml0ZShNYXRoLnJhbmRvbSgpKTsgICAgICAgLy8gQWx3YXlzIDAuNTU0NzY5NDMyNDczNDU1XG4vL1xuLy8gICBNYXRoLnNlZWRyYW5kb20oYXV0b3NlZWQpOyAgICAgICAgICAgLy8gUmVzdGFydCBhdCB0aGUgcHJldmlvdXMgc2VlZC5cbi8vICAgZG9jdW1lbnQud3JpdGUoTWF0aC5yYW5kb20oKSk7ICAgICAgIC8vIFJlcGVhdCB0aGUgJ3VucHJlZGljdGFibGUnIHZhbHVlLlxuLy9cbi8vIE5vdGVzOlxuLy9cbi8vIEVhY2ggdGltZSBzZWVkcmFuZG9tKCdhcmcnKSBpcyBjYWxsZWQsIGVudHJvcHkgZnJvbSB0aGUgcGFzc2VkIHNlZWRcbi8vIGlzIGFjY3VtdWxhdGVkIGluIGEgcG9vbCB0byBoZWxwIGdlbmVyYXRlIGZ1dHVyZSBzZWVkcyBmb3IgdGhlXG4vLyB6ZXJvLWFyZ3VtZW50IGZvcm0gb2YgTWF0aC5zZWVkcmFuZG9tLCBzbyBlbnRyb3B5IGNhbiBiZSBpbmplY3RlZCBvdmVyXG4vLyB0aW1lIGJ5IGNhbGxpbmcgc2VlZHJhbmRvbSB3aXRoIGV4cGxpY2l0IGRhdGEgcmVwZWF0ZWRseS5cbi8vXG4vLyBPbiBzcGVlZCAtIFRoaXMgamF2YXNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiBNYXRoLnJhbmRvbSgpIGlzIGFib3V0XG4vLyAzLTEweCBzbG93ZXIgdGhhbiB0aGUgYnVpbHQtaW4gTWF0aC5yYW5kb20oKSBiZWNhdXNlIGl0IGlzIG5vdCBuYXRpdmVcbi8vIGNvZGUsIGJ1dCB0aGlzIGlzIHR5cGljYWxseSBmYXN0IGVub3VnaCBhbnl3YXkuICBTZWVkaW5nIGlzIG1vcmUgZXhwZW5zaXZlLFxuLy8gZXNwZWNpYWxseSBpZiB5b3UgdXNlIGF1dG8tc2VlZGluZy4gIFNvbWUgZGV0YWlscyAodGltaW5ncyBvbiBDaHJvbWUgNCk6XG4vL1xuLy8gT3VyIE1hdGgucmFuZG9tKCkgICAgICAgICAgICAtIGF2ZyBsZXNzIHRoYW4gMC4wMDIgbWlsbGlzZWNvbmRzIHBlciBjYWxsXG4vLyBzZWVkcmFuZG9tKCdleHBsaWNpdCcpICAgICAgIC0gYXZnIGxlc3MgdGhhbiAwLjUgbWlsbGlzZWNvbmRzIHBlciBjYWxsXG4vLyBzZWVkcmFuZG9tKCdleHBsaWNpdCcsIHRydWUpIC0gYXZnIGxlc3MgdGhhbiAyIG1pbGxpc2Vjb25kcyBwZXIgY2FsbFxuLy8gc2VlZHJhbmRvbSgpICAgICAgICAgICAgICAgICAtIGF2ZyBhYm91dCAzOCBtaWxsaXNlY29uZHMgcGVyIGNhbGxcbi8vXG4vLyBMSUNFTlNFIChCU0QpOlxuLy9cbi8vIENvcHlyaWdodCAyMDEwIERhdmlkIEJhdSwgYWxsIHJpZ2h0cyByZXNlcnZlZC5cbi8vXG4vLyBSZWRpc3RyaWJ1dGlvbiBhbmQgdXNlIGluIHNvdXJjZSBhbmQgYmluYXJ5IGZvcm1zLCB3aXRoIG9yIHdpdGhvdXRcbi8vIG1vZGlmaWNhdGlvbiwgYXJlIHBlcm1pdHRlZCBwcm92aWRlZCB0aGF0IHRoZSBmb2xsb3dpbmcgY29uZGl0aW9ucyBhcmUgbWV0OlxuLy8gXG4vLyAgIDEuIFJlZGlzdHJpYnV0aW9ucyBvZiBzb3VyY2UgY29kZSBtdXN0IHJldGFpbiB0aGUgYWJvdmUgY29weXJpZ2h0XG4vLyAgICAgIG5vdGljZSwgdGhpcyBsaXN0IG9mIGNvbmRpdGlvbnMgYW5kIHRoZSBmb2xsb3dpbmcgZGlzY2xhaW1lci5cbi8vXG4vLyAgIDIuIFJlZGlzdHJpYnV0aW9ucyBpbiBiaW5hcnkgZm9ybSBtdXN0IHJlcHJvZHVjZSB0aGUgYWJvdmUgY29weXJpZ2h0XG4vLyAgICAgIG5vdGljZSwgdGhpcyBsaXN0IG9mIGNvbmRpdGlvbnMgYW5kIHRoZSBmb2xsb3dpbmcgZGlzY2xhaW1lciBpbiB0aGVcbi8vICAgICAgZG9jdW1lbnRhdGlvbiBhbmQvb3Igb3RoZXIgbWF0ZXJpYWxzIHByb3ZpZGVkIHdpdGggdGhlIGRpc3RyaWJ1dGlvbi5cbi8vIFxuLy8gICAzLiBOZWl0aGVyIHRoZSBuYW1lIG9mIHRoaXMgbW9kdWxlIG5vciB0aGUgbmFtZXMgb2YgaXRzIGNvbnRyaWJ1dG9ycyBtYXlcbi8vICAgICAgYmUgdXNlZCB0byBlbmRvcnNlIG9yIHByb21vdGUgcHJvZHVjdHMgZGVyaXZlZCBmcm9tIHRoaXMgc29mdHdhcmVcbi8vICAgICAgd2l0aG91dCBzcGVjaWZpYyBwcmlvciB3cml0dGVuIHBlcm1pc3Npb24uXG4vLyBcbi8vIFRISVMgU09GVFdBUkUgSVMgUFJPVklERUQgQlkgVEhFIENPUFlSSUdIVCBIT0xERVJTIEFORCBDT05UUklCVVRPUlNcbi8vIFwiQVMgSVNcIiBBTkQgQU5ZIEVYUFJFU1MgT1IgSU1QTElFRCBXQVJSQU5USUVTLCBJTkNMVURJTkcsIEJVVCBOT1Rcbi8vIExJTUlURUQgVE8sIFRIRSBJTVBMSUVEIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORCBGSVRORVNTIEZPUlxuLy8gQSBQQVJUSUNVTEFSIFBVUlBPU0UgQVJFIERJU0NMQUlNRUQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRSBDT1BZUklHSFRcbi8vIE9XTkVSIE9SIENPTlRSSUJVVE9SUyBCRSBMSUFCTEUgRk9SIEFOWSBESVJFQ1QsIElORElSRUNULCBJTkNJREVOVEFMLFxuLy8gU1BFQ0lBTCwgRVhFTVBMQVJZLCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgKElOQ0xVRElORywgQlVUIE5PVFxuLy8gTElNSVRFRCBUTywgUFJPQ1VSRU1FTlQgT0YgU1VCU1RJVFVURSBHT09EUyBPUiBTRVJWSUNFUzsgTE9TUyBPRiBVU0UsXG4vLyBEQVRBLCBPUiBQUk9GSVRTOyBPUiBCVVNJTkVTUyBJTlRFUlJVUFRJT04pIEhPV0VWRVIgQ0FVU0VEIEFORCBPTiBBTllcbi8vIFRIRU9SWSBPRiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlRcbi8vIChJTkNMVURJTkcgTkVHTElHRU5DRSBPUiBPVEhFUldJU0UpIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRVxuLy8gT0YgVEhJUyBTT0ZUV0FSRSwgRVZFTiBJRiBBRFZJU0VEIE9GIFRIRSBQT1NTSUJJTElUWSBPRiBTVUNIIERBTUFHRS5cbi8vXG4vKipcbiAqIEFsbCBjb2RlIGlzIGluIGFuIGFub255bW91cyBjbG9zdXJlIHRvIGtlZXAgdGhlIGdsb2JhbCBuYW1lc3BhY2UgY2xlYW4uXG4gKlxuICogQHBhcmFtIHtudW1iZXI9fSBvdmVyZmxvdyBcbiAqIEBwYXJhbSB7bnVtYmVyPX0gc3RhcnRkZW5vbVxuICovXG5cbi8vIFBhdGNoZWQgYnkgU2ViIHNvIHRoYXQgc2VlZHJhbmRvbS5qcyBkb2VzIG5vdCBwb2xsdXRlIHRoZSBNYXRoIG9iamVjdC5cbi8vIE15IHRlc3RzIHN1Z2dlc3QgdGhhdCBkb2luZyBNYXRoLnRyb3VibGUgPSAxIG1ha2VzIE1hdGggbG9va3VwcyBhYm91dCA1JVxuLy8gc2xvd2VyLlxubnVtZXJpYy5zZWVkcmFuZG9tID0geyBwb3c6TWF0aC5wb3csIHJhbmRvbTpNYXRoLnJhbmRvbSB9O1xuXG4oZnVuY3Rpb24gKHBvb2wsIG1hdGgsIHdpZHRoLCBjaHVua3MsIHNpZ25pZmljYW5jZSwgb3ZlcmZsb3csIHN0YXJ0ZGVub20pIHtcblxuXG4vL1xuLy8gc2VlZHJhbmRvbSgpXG4vLyBUaGlzIGlzIHRoZSBzZWVkcmFuZG9tIGZ1bmN0aW9uIGRlc2NyaWJlZCBhYm92ZS5cbi8vXG5tYXRoWydzZWVkcmFuZG9tJ10gPSBmdW5jdGlvbiBzZWVkcmFuZG9tKHNlZWQsIHVzZV9lbnRyb3B5KSB7XG4gIHZhciBrZXkgPSBbXTtcbiAgdmFyIGFyYzQ7XG5cbiAgLy8gRmxhdHRlbiB0aGUgc2VlZCBzdHJpbmcgb3IgYnVpbGQgb25lIGZyb20gbG9jYWwgZW50cm9weSBpZiBuZWVkZWQuXG4gIHNlZWQgPSBtaXhrZXkoZmxhdHRlbihcbiAgICB1c2VfZW50cm9weSA/IFtzZWVkLCBwb29sXSA6XG4gICAgYXJndW1lbnRzLmxlbmd0aCA/IHNlZWQgOlxuICAgIFtuZXcgRGF0ZSgpLmdldFRpbWUoKSwgcG9vbCwgd2luZG93XSwgMyksIGtleSk7XG5cbiAgLy8gVXNlIHRoZSBzZWVkIHRvIGluaXRpYWxpemUgYW4gQVJDNCBnZW5lcmF0b3IuXG4gIGFyYzQgPSBuZXcgQVJDNChrZXkpO1xuXG4gIC8vIE1peCB0aGUgcmFuZG9tbmVzcyBpbnRvIGFjY3VtdWxhdGVkIGVudHJvcHkuXG4gIG1peGtleShhcmM0LlMsIHBvb2wpO1xuXG4gIC8vIE92ZXJyaWRlIE1hdGgucmFuZG9tXG5cbiAgLy8gVGhpcyBmdW5jdGlvbiByZXR1cm5zIGEgcmFuZG9tIGRvdWJsZSBpbiBbMCwgMSkgdGhhdCBjb250YWluc1xuICAvLyByYW5kb21uZXNzIGluIGV2ZXJ5IGJpdCBvZiB0aGUgbWFudGlzc2Egb2YgdGhlIElFRUUgNzU0IHZhbHVlLlxuXG4gIG1hdGhbJ3JhbmRvbSddID0gZnVuY3Rpb24gcmFuZG9tKCkgeyAgLy8gQ2xvc3VyZSB0byByZXR1cm4gYSByYW5kb20gZG91YmxlOlxuICAgIHZhciBuID0gYXJjNC5nKGNodW5rcyk7ICAgICAgICAgICAgIC8vIFN0YXJ0IHdpdGggYSBudW1lcmF0b3IgbiA8IDIgXiA0OFxuICAgIHZhciBkID0gc3RhcnRkZW5vbTsgICAgICAgICAgICAgICAgIC8vICAgYW5kIGRlbm9taW5hdG9yIGQgPSAyIF4gNDguXG4gICAgdmFyIHggPSAwOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBhbmQgbm8gJ2V4dHJhIGxhc3QgYnl0ZScuXG4gICAgd2hpbGUgKG4gPCBzaWduaWZpY2FuY2UpIHsgICAgICAgICAgLy8gRmlsbCB1cCBhbGwgc2lnbmlmaWNhbnQgZGlnaXRzIGJ5XG4gICAgICBuID0gKG4gKyB4KSAqIHdpZHRoOyAgICAgICAgICAgICAgLy8gICBzaGlmdGluZyBudW1lcmF0b3IgYW5kXG4gICAgICBkICo9IHdpZHRoOyAgICAgICAgICAgICAgICAgICAgICAgLy8gICBkZW5vbWluYXRvciBhbmQgZ2VuZXJhdGluZyBhXG4gICAgICB4ID0gYXJjNC5nKDEpOyAgICAgICAgICAgICAgICAgICAgLy8gICBuZXcgbGVhc3Qtc2lnbmlmaWNhbnQtYnl0ZS5cbiAgICB9XG4gICAgd2hpbGUgKG4gPj0gb3ZlcmZsb3cpIHsgICAgICAgICAgICAgLy8gVG8gYXZvaWQgcm91bmRpbmcgdXAsIGJlZm9yZSBhZGRpbmdcbiAgICAgIG4gLz0gMjsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGxhc3QgYnl0ZSwgc2hpZnQgZXZlcnl0aGluZ1xuICAgICAgZCAvPSAyOyAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgcmlnaHQgdXNpbmcgaW50ZWdlciBtYXRoIHVudGlsXG4gICAgICB4ID4+Pj0gMTsgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICB3ZSBoYXZlIGV4YWN0bHkgdGhlIGRlc2lyZWQgYml0cy5cbiAgICB9XG4gICAgcmV0dXJuIChuICsgeCkgLyBkOyAgICAgICAgICAgICAgICAgLy8gRm9ybSB0aGUgbnVtYmVyIHdpdGhpbiBbMCwgMSkuXG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSBzZWVkIHRoYXQgd2FzIHVzZWRcbiAgcmV0dXJuIHNlZWQ7XG59O1xuXG4vL1xuLy8gQVJDNFxuLy9cbi8vIEFuIEFSQzQgaW1wbGVtZW50YXRpb24uICBUaGUgY29uc3RydWN0b3IgdGFrZXMgYSBrZXkgaW4gdGhlIGZvcm0gb2Zcbi8vIGFuIGFycmF5IG9mIGF0IG1vc3QgKHdpZHRoKSBpbnRlZ2VycyB0aGF0IHNob3VsZCBiZSAwIDw9IHggPCAod2lkdGgpLlxuLy9cbi8vIFRoZSBnKGNvdW50KSBtZXRob2QgcmV0dXJucyBhIHBzZXVkb3JhbmRvbSBpbnRlZ2VyIHRoYXQgY29uY2F0ZW5hdGVzXG4vLyB0aGUgbmV4dCAoY291bnQpIG91dHB1dHMgZnJvbSBBUkM0LiAgSXRzIHJldHVybiB2YWx1ZSBpcyBhIG51bWJlciB4XG4vLyB0aGF0IGlzIGluIHRoZSByYW5nZSAwIDw9IHggPCAod2lkdGggXiBjb3VudCkuXG4vL1xuLyoqIEBjb25zdHJ1Y3RvciAqL1xuZnVuY3Rpb24gQVJDNChrZXkpIHtcbiAgdmFyIHQsIHUsIG1lID0gdGhpcywga2V5bGVuID0ga2V5Lmxlbmd0aDtcbiAgdmFyIGkgPSAwLCBqID0gbWUuaSA9IG1lLmogPSBtZS5tID0gMDtcbiAgbWUuUyA9IFtdO1xuICBtZS5jID0gW107XG5cbiAgLy8gVGhlIGVtcHR5IGtleSBbXSBpcyB0cmVhdGVkIGFzIFswXS5cbiAgaWYgKCFrZXlsZW4pIHsga2V5ID0gW2tleWxlbisrXTsgfVxuXG4gIC8vIFNldCB1cCBTIHVzaW5nIHRoZSBzdGFuZGFyZCBrZXkgc2NoZWR1bGluZyBhbGdvcml0aG0uXG4gIHdoaWxlIChpIDwgd2lkdGgpIHsgbWUuU1tpXSA9IGkrKzsgfVxuICBmb3IgKGkgPSAwOyBpIDwgd2lkdGg7IGkrKykge1xuICAgIHQgPSBtZS5TW2ldO1xuICAgIGogPSBsb3diaXRzKGogKyB0ICsga2V5W2kgJSBrZXlsZW5dKTtcbiAgICB1ID0gbWUuU1tqXTtcbiAgICBtZS5TW2ldID0gdTtcbiAgICBtZS5TW2pdID0gdDtcbiAgfVxuXG4gIC8vIFRoZSBcImdcIiBtZXRob2QgcmV0dXJucyB0aGUgbmV4dCAoY291bnQpIG91dHB1dHMgYXMgb25lIG51bWJlci5cbiAgbWUuZyA9IGZ1bmN0aW9uIGdldG5leHQoY291bnQpIHtcbiAgICB2YXIgcyA9IG1lLlM7XG4gICAgdmFyIGkgPSBsb3diaXRzKG1lLmkgKyAxKTsgdmFyIHQgPSBzW2ldO1xuICAgIHZhciBqID0gbG93Yml0cyhtZS5qICsgdCk7IHZhciB1ID0gc1tqXTtcbiAgICBzW2ldID0gdTtcbiAgICBzW2pdID0gdDtcbiAgICB2YXIgciA9IHNbbG93Yml0cyh0ICsgdSldO1xuICAgIHdoaWxlICgtLWNvdW50KSB7XG4gICAgICBpID0gbG93Yml0cyhpICsgMSk7IHQgPSBzW2ldO1xuICAgICAgaiA9IGxvd2JpdHMoaiArIHQpOyB1ID0gc1tqXTtcbiAgICAgIHNbaV0gPSB1O1xuICAgICAgc1tqXSA9IHQ7XG4gICAgICByID0gciAqIHdpZHRoICsgc1tsb3diaXRzKHQgKyB1KV07XG4gICAgfVxuICAgIG1lLmkgPSBpO1xuICAgIG1lLmogPSBqO1xuICAgIHJldHVybiByO1xuICB9O1xuICAvLyBGb3Igcm9idXN0IHVucHJlZGljdGFiaWxpdHkgZGlzY2FyZCBhbiBpbml0aWFsIGJhdGNoIG9mIHZhbHVlcy5cbiAgLy8gU2VlIGh0dHA6Ly93d3cucnNhLmNvbS9yc2FsYWJzL25vZGUuYXNwP2lkPTIwMDlcbiAgbWUuZyh3aWR0aCk7XG59XG5cbi8vXG4vLyBmbGF0dGVuKClcbi8vIENvbnZlcnRzIGFuIG9iamVjdCB0cmVlIHRvIG5lc3RlZCBhcnJheXMgb2Ygc3RyaW5ncy5cbi8vXG4vKiogQHBhcmFtIHtPYmplY3Q9fSByZXN1bHQgXG4gICogQHBhcmFtIHtzdHJpbmc9fSBwcm9wXG4gICogQHBhcmFtIHtzdHJpbmc9fSB0eXAgKi9cbmZ1bmN0aW9uIGZsYXR0ZW4ob2JqLCBkZXB0aCwgcmVzdWx0LCBwcm9wLCB0eXApIHtcbiAgcmVzdWx0ID0gW107XG4gIHR5cCA9IHR5cGVvZihvYmopO1xuICBpZiAoZGVwdGggJiYgdHlwID09ICdvYmplY3QnKSB7XG4gICAgZm9yIChwcm9wIGluIG9iaikge1xuICAgICAgaWYgKHByb3AuaW5kZXhPZignUycpIDwgNSkgeyAgICAvLyBBdm9pZCBGRjMgYnVnIChsb2NhbC9zZXNzaW9uU3RvcmFnZSlcbiAgICAgICAgdHJ5IHsgcmVzdWx0LnB1c2goZmxhdHRlbihvYmpbcHJvcF0sIGRlcHRoIC0gMSkpOyB9IGNhdGNoIChlKSB7fVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gKHJlc3VsdC5sZW5ndGggPyByZXN1bHQgOiBvYmogKyAodHlwICE9ICdzdHJpbmcnID8gJ1xcMCcgOiAnJykpO1xufVxuXG4vL1xuLy8gbWl4a2V5KClcbi8vIE1peGVzIGEgc3RyaW5nIHNlZWQgaW50byBhIGtleSB0aGF0IGlzIGFuIGFycmF5IG9mIGludGVnZXJzLCBhbmRcbi8vIHJldHVybnMgYSBzaG9ydGVuZWQgc3RyaW5nIHNlZWQgdGhhdCBpcyBlcXVpdmFsZW50IHRvIHRoZSByZXN1bHQga2V5LlxuLy9cbi8qKiBAcGFyYW0ge251bWJlcj19IHNtZWFyIFxuICAqIEBwYXJhbSB7bnVtYmVyPX0gaiAqL1xuZnVuY3Rpb24gbWl4a2V5KHNlZWQsIGtleSwgc21lYXIsIGopIHtcbiAgc2VlZCArPSAnJzsgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoZSBzZWVkIGlzIGEgc3RyaW5nXG4gIHNtZWFyID0gMDtcbiAgZm9yIChqID0gMDsgaiA8IHNlZWQubGVuZ3RoOyBqKyspIHtcbiAgICBrZXlbbG93Yml0cyhqKV0gPVxuICAgICAgbG93Yml0cygoc21lYXIgXj0ga2V5W2xvd2JpdHMoaildICogMTkpICsgc2VlZC5jaGFyQ29kZUF0KGopKTtcbiAgfVxuICBzZWVkID0gJyc7XG4gIGZvciAoaiBpbiBrZXkpIHsgc2VlZCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGtleVtqXSk7IH1cbiAgcmV0dXJuIHNlZWQ7XG59XG5cbi8vXG4vLyBsb3diaXRzKClcbi8vIEEgcXVpY2sgXCJuIG1vZCB3aWR0aFwiIGZvciB3aWR0aCBhIHBvd2VyIG9mIDIuXG4vL1xuZnVuY3Rpb24gbG93Yml0cyhuKSB7IHJldHVybiBuICYgKHdpZHRoIC0gMSk7IH1cblxuLy9cbi8vIFRoZSBmb2xsb3dpbmcgY29uc3RhbnRzIGFyZSByZWxhdGVkIHRvIElFRUUgNzU0IGxpbWl0cy5cbi8vXG5zdGFydGRlbm9tID0gbWF0aC5wb3cod2lkdGgsIGNodW5rcyk7XG5zaWduaWZpY2FuY2UgPSBtYXRoLnBvdygyLCBzaWduaWZpY2FuY2UpO1xub3ZlcmZsb3cgPSBzaWduaWZpY2FuY2UgKiAyO1xuXG4vL1xuLy8gV2hlbiBzZWVkcmFuZG9tLmpzIGlzIGxvYWRlZCwgd2UgaW1tZWRpYXRlbHkgbWl4IGEgZmV3IGJpdHNcbi8vIGZyb20gdGhlIGJ1aWx0LWluIFJORyBpbnRvIHRoZSBlbnRyb3B5IHBvb2wuICBCZWNhdXNlIHdlIGRvXG4vLyBub3Qgd2FudCB0byBpbnRlZmVyZSB3aXRoIGRldGVybWluc3RpYyBQUk5HIHN0YXRlIGxhdGVyLFxuLy8gc2VlZHJhbmRvbSB3aWxsIG5vdCBjYWxsIG1hdGgucmFuZG9tIG9uIGl0cyBvd24gYWdhaW4gYWZ0ZXJcbi8vIGluaXRpYWxpemF0aW9uLlxuLy9cbm1peGtleShtYXRoLnJhbmRvbSgpLCBwb29sKTtcblxuLy8gRW5kIGFub255bW91cyBzY29wZSwgYW5kIHBhc3MgaW5pdGlhbCB2YWx1ZXMuXG59KFxuICBbXSwgICAvLyBwb29sOiBlbnRyb3B5IHBvb2wgc3RhcnRzIGVtcHR5XG4gIG51bWVyaWMuc2VlZHJhbmRvbSwgLy8gbWF0aDogcGFja2FnZSBjb250YWluaW5nIHJhbmRvbSwgcG93LCBhbmQgc2VlZHJhbmRvbVxuICAyNTYsICAvLyB3aWR0aDogZWFjaCBSQzQgb3V0cHV0IGlzIDAgPD0geCA8IDI1NlxuICA2LCAgICAvLyBjaHVua3M6IGF0IGxlYXN0IHNpeCBSQzQgb3V0cHV0cyBmb3IgZWFjaCBkb3VibGVcbiAgNTIgICAgLy8gc2lnbmlmaWNhbmNlOiB0aGVyZSBhcmUgNTIgc2lnbmlmaWNhbnQgZGlnaXRzIGluIGEgZG91YmxlXG4gICkpO1xuLyogVGhpcyBmaWxlIGlzIGEgc2xpZ2h0bHkgbW9kaWZpZWQgdmVyc2lvbiBvZiBxdWFkcHJvZy5qcyBmcm9tIEFsYmVydG8gU2FudGluaS5cbiAqIEl0IGhhcyBiZWVuIHNsaWdodGx5IG1vZGlmaWVkIGJ5IFPDqWJhc3RpZW4gTG9pc2VsIHRvIG1ha2Ugc3VyZSB0aGF0IGl0IGhhbmRsZXNcbiAqIDAtYmFzZWQgQXJyYXlzIGluc3RlYWQgb2YgMS1iYXNlZCBBcnJheXMuXG4gKiBMaWNlbnNlIGlzIGluIHJlc291cmNlcy9MSUNFTlNFLnF1YWRwcm9nICovXG4oZnVuY3Rpb24oZXhwb3J0cykge1xuXG5mdW5jdGlvbiBiYXNlMHRvMShBKSB7XG4gICAgaWYodHlwZW9mIEEgIT09IFwib2JqZWN0XCIpIHsgcmV0dXJuIEE7IH1cbiAgICB2YXIgcmV0ID0gW10sIGksbj1BLmxlbmd0aDtcbiAgICBmb3IoaT0wO2k8bjtpKyspIHJldFtpKzFdID0gYmFzZTB0bzEoQVtpXSk7XG4gICAgcmV0dXJuIHJldDtcbn1cbmZ1bmN0aW9uIGJhc2UxdG8wKEEpIHtcbiAgICBpZih0eXBlb2YgQSAhPT0gXCJvYmplY3RcIikgeyByZXR1cm4gQTsgfVxuICAgIHZhciByZXQgPSBbXSwgaSxuPUEubGVuZ3RoO1xuICAgIGZvcihpPTE7aTxuO2krKykgcmV0W2ktMV0gPSBiYXNlMXRvMChBW2ldKTtcbiAgICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiBkcG9yaShhLCBsZGEsIG4pIHtcbiAgICB2YXIgaSwgaiwgaywga3AxLCB0O1xuXG4gICAgZm9yIChrID0gMTsgayA8PSBuOyBrID0gayArIDEpIHtcbiAgICAgICAgYVtrXVtrXSA9IDEgLyBhW2tdW2tdO1xuICAgICAgICB0ID0gLWFba11ba107XG4gICAgICAgIC8vfiBkc2NhbChrIC0gMSwgdCwgYVsxXVtrXSwgMSk7XG4gICAgICAgIGZvciAoaSA9IDE7IGkgPCBrOyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgIGFbaV1ba10gPSB0ICogYVtpXVtrXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGtwMSA9IGsgKyAxO1xuICAgICAgICBpZiAobiA8IGtwMSkge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChqID0ga3AxOyBqIDw9IG47IGogPSBqICsgMSkge1xuICAgICAgICAgICAgdCA9IGFba11bal07XG4gICAgICAgICAgICBhW2tdW2pdID0gMDtcbiAgICAgICAgICAgIC8vfiBkYXhweShrLCB0LCBhWzFdW2tdLCAxLCBhWzFdW2pdLCAxKTtcbiAgICAgICAgICAgIGZvciAoaSA9IDE7IGkgPD0gazsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICAgICAgYVtpXVtqXSA9IGFbaV1bal0gKyAodCAqIGFbaV1ba10pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG59XG5cbmZ1bmN0aW9uIGRwb3NsKGEsIGxkYSwgbiwgYikge1xuICAgIHZhciBpLCBrLCBrYiwgdDtcblxuICAgIGZvciAoayA9IDE7IGsgPD0gbjsgayA9IGsgKyAxKSB7XG4gICAgICAgIC8vfiB0ID0gZGRvdChrIC0gMSwgYVsxXVtrXSwgMSwgYlsxXSwgMSk7XG4gICAgICAgIHQgPSAwO1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDwgazsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICB0ID0gdCArIChhW2ldW2tdICogYltpXSk7XG4gICAgICAgIH1cblxuICAgICAgICBiW2tdID0gKGJba10gLSB0KSAvIGFba11ba107XG4gICAgfVxuXG4gICAgZm9yIChrYiA9IDE7IGtiIDw9IG47IGtiID0ga2IgKyAxKSB7XG4gICAgICAgIGsgPSBuICsgMSAtIGtiO1xuICAgICAgICBiW2tdID0gYltrXSAvIGFba11ba107XG4gICAgICAgIHQgPSAtYltrXTtcbiAgICAgICAgLy9+IGRheHB5KGsgLSAxLCB0LCBhWzFdW2tdLCAxLCBiWzFdLCAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGs7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgYltpXSA9IGJbaV0gKyAodCAqIGFbaV1ba10pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkcG9mYShhLCBsZGEsIG4sIGluZm8pIHtcbiAgICB2YXIgaSwgaiwgam0xLCBrLCB0LCBzO1xuXG4gICAgZm9yIChqID0gMTsgaiA8PSBuOyBqID0gaiArIDEpIHtcbiAgICAgICAgaW5mb1sxXSA9IGo7XG4gICAgICAgIHMgPSAwO1xuICAgICAgICBqbTEgPSBqIC0gMTtcbiAgICAgICAgaWYgKGptMSA8IDEpIHtcbiAgICAgICAgICAgIHMgPSBhW2pdW2pdIC0gcztcbiAgICAgICAgICAgIGlmIChzIDw9IDApIHtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGFbal1bal0gPSBNYXRoLnNxcnQocyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGsgPSAxOyBrIDw9IGptMTsgayA9IGsgKyAxKSB7XG4gICAgICAgICAgICAgICAgLy9+IHQgPSBhW2tdW2pdIC0gZGRvdChrIC0gMSwgYVsxXVtrXSwgMSwgYVsxXVtqXSwgMSk7XG4gICAgICAgICAgICAgICAgdCA9IGFba11bal07XG4gICAgICAgICAgICAgICAgZm9yIChpID0gMTsgaSA8IGs7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgICAgICB0ID0gdCAtIChhW2ldW2pdICogYVtpXVtrXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHQgPSB0IC8gYVtrXVtrXTtcbiAgICAgICAgICAgICAgICBhW2tdW2pdID0gdDtcbiAgICAgICAgICAgICAgICBzID0gcyArIHQgKiB0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcyA9IGFbal1bal0gLSBzO1xuICAgICAgICAgICAgaWYgKHMgPD0gMCkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYVtqXVtqXSA9IE1hdGguc3FydChzKTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvWzFdID0gMDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHFwZ2VuMihkbWF0LCBkdmVjLCBmZGRtYXQsIG4sIHNvbCwgY3J2YWwsIGFtYXQsXG4gICAgYnZlYywgZmRhbWF0LCBxLCBtZXEsIGlhY3QsIG5hY3QsIGl0ZXIsIHdvcmssIGllcnIpIHtcblxuICAgIHZhciBpLCBqLCBsLCBsMSwgaW5mbywgaXQxLCBpd3p2LCBpd3J2LCBpd3JtLCBpd3N2LCBpd3V2LCBudmwsIHIsIGl3bmJ2LFxuICAgICAgICB0ZW1wLCBzdW0sIHQxLCB0dCwgZ2MsIGdzLCBudSxcbiAgICAgICAgdDFpbmYsIHQybWluLFxuICAgICAgICB2c21hbGwsIHRtcGEsIHRtcGIsXG4gICAgICAgIGdvO1xuXG4gICAgciA9IE1hdGgubWluKG4sIHEpO1xuICAgIGwgPSAyICogbiArIChyICogKHIgKyA1KSkgLyAyICsgMiAqIHEgKyAxO1xuXG4gICAgdnNtYWxsID0gMS4wZS02MDtcbiAgICBkbyB7XG4gICAgICAgIHZzbWFsbCA9IHZzbWFsbCArIHZzbWFsbDtcbiAgICAgICAgdG1wYSA9IDEgKyAwLjEgKiB2c21hbGw7XG4gICAgICAgIHRtcGIgPSAxICsgMC4yICogdnNtYWxsO1xuICAgIH0gd2hpbGUgKHRtcGEgPD0gMSB8fCB0bXBiIDw9IDEpO1xuXG4gICAgZm9yIChpID0gMTsgaSA8PSBuOyBpID0gaSArIDEpIHtcbiAgICAgICAgd29ya1tpXSA9IGR2ZWNbaV07XG4gICAgfVxuICAgIGZvciAoaSA9IG4gKyAxOyBpIDw9IGw7IGkgPSBpICsgMSkge1xuICAgICAgICB3b3JrW2ldID0gMDtcbiAgICB9XG4gICAgZm9yIChpID0gMTsgaSA8PSBxOyBpID0gaSArIDEpIHtcbiAgICAgICAgaWFjdFtpXSA9IDA7XG4gICAgfVxuXG4gICAgaW5mbyA9IFtdO1xuXG4gICAgaWYgKGllcnJbMV0gPT09IDApIHtcbiAgICAgICAgZHBvZmEoZG1hdCwgZmRkbWF0LCBuLCBpbmZvKTtcbiAgICAgICAgaWYgKGluZm9bMV0gIT09IDApIHtcbiAgICAgICAgICAgIGllcnJbMV0gPSAyO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGRwb3NsKGRtYXQsIGZkZG1hdCwgbiwgZHZlYyk7XG4gICAgICAgIGRwb3JpKGRtYXQsIGZkZG1hdCwgbik7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgZm9yIChqID0gMTsgaiA8PSBuOyBqID0gaiArIDEpIHtcbiAgICAgICAgICAgIHNvbFtqXSA9IDA7XG4gICAgICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IGo7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgIHNvbFtqXSA9IHNvbFtqXSArIGRtYXRbaV1bal0gKiBkdmVjW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGZvciAoaiA9IDE7IGogPD0gbjsgaiA9IGogKyAxKSB7XG4gICAgICAgICAgICBkdmVjW2pdID0gMDtcbiAgICAgICAgICAgIGZvciAoaSA9IGo7IGkgPD0gbjsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICAgICAgZHZlY1tqXSA9IGR2ZWNbal0gKyBkbWF0W2pdW2ldICogc29sW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY3J2YWxbMV0gPSAwO1xuICAgIGZvciAoaiA9IDE7IGogPD0gbjsgaiA9IGogKyAxKSB7XG4gICAgICAgIHNvbFtqXSA9IGR2ZWNbal07XG4gICAgICAgIGNydmFsWzFdID0gY3J2YWxbMV0gKyB3b3JrW2pdICogc29sW2pdO1xuICAgICAgICB3b3JrW2pdID0gMDtcbiAgICAgICAgZm9yIChpID0gaiArIDE7IGkgPD0gbjsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICBkbWF0W2ldW2pdID0gMDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjcnZhbFsxXSA9IC1jcnZhbFsxXSAvIDI7XG4gICAgaWVyclsxXSA9IDA7XG5cbiAgICBpd3p2ID0gbjtcbiAgICBpd3J2ID0gaXd6diArIG47XG4gICAgaXd1diA9IGl3cnYgKyByO1xuICAgIGl3cm0gPSBpd3V2ICsgciArIDE7XG4gICAgaXdzdiA9IGl3cm0gKyAociAqIChyICsgMSkpIC8gMjtcbiAgICBpd25idiA9IGl3c3YgKyBxO1xuXG4gICAgZm9yIChpID0gMTsgaSA8PSBxOyBpID0gaSArIDEpIHtcbiAgICAgICAgc3VtID0gMDtcbiAgICAgICAgZm9yIChqID0gMTsgaiA8PSBuOyBqID0gaiArIDEpIHtcbiAgICAgICAgICAgIHN1bSA9IHN1bSArIGFtYXRbal1baV0gKiBhbWF0W2pdW2ldO1xuICAgICAgICB9XG4gICAgICAgIHdvcmtbaXduYnYgKyBpXSA9IE1hdGguc3FydChzdW0pO1xuICAgIH1cbiAgICBuYWN0ID0gMDtcbiAgICBpdGVyWzFdID0gMDtcbiAgICBpdGVyWzJdID0gMDtcblxuICAgIGZ1bmN0aW9uIGZuX2dvdG9fNTAoKSB7XG4gICAgICAgIGl0ZXJbMV0gPSBpdGVyWzFdICsgMTtcblxuICAgICAgICBsID0gaXdzdjtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8PSBxOyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgIGwgPSBsICsgMTtcbiAgICAgICAgICAgIHN1bSA9IC1idmVjW2ldO1xuICAgICAgICAgICAgZm9yIChqID0gMTsgaiA8PSBuOyBqID0gaiArIDEpIHtcbiAgICAgICAgICAgICAgICBzdW0gPSBzdW0gKyBhbWF0W2pdW2ldICogc29sW2pdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKE1hdGguYWJzKHN1bSkgPCB2c21hbGwpIHtcbiAgICAgICAgICAgICAgICBzdW0gPSAwO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGkgPiBtZXEpIHtcbiAgICAgICAgICAgICAgICB3b3JrW2xdID0gc3VtO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB3b3JrW2xdID0gLU1hdGguYWJzKHN1bSk7XG4gICAgICAgICAgICAgICAgaWYgKHN1bSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChqID0gMTsgaiA8PSBuOyBqID0gaiArIDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFtYXRbal1baV0gPSAtYW1hdFtqXVtpXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBidmVjW2ldID0gLWJ2ZWNbaV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChpID0gMTsgaSA8PSBuYWN0OyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgIHdvcmtbaXdzdiArIGlhY3RbaV1dID0gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIG52bCA9IDA7XG4gICAgICAgIHRlbXAgPSAwO1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IHE7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgaWYgKHdvcmtbaXdzdiArIGldIDwgdGVtcCAqIHdvcmtbaXduYnYgKyBpXSkge1xuICAgICAgICAgICAgICAgIG52bCA9IGk7XG4gICAgICAgICAgICAgICAgdGVtcCA9IHdvcmtbaXdzdiArIGldIC8gd29ya1tpd25idiArIGldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChudmwgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiA5OTk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbl9nb3RvXzU1KCkge1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IG47IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgc3VtID0gMDtcbiAgICAgICAgICAgIGZvciAoaiA9IDE7IGogPD0gbjsgaiA9IGogKyAxKSB7XG4gICAgICAgICAgICAgICAgc3VtID0gc3VtICsgZG1hdFtqXVtpXSAqIGFtYXRbal1bbnZsXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHdvcmtbaV0gPSBzdW07XG4gICAgICAgIH1cblxuICAgICAgICBsMSA9IGl3enY7XG4gICAgICAgIGZvciAoaSA9IDE7IGkgPD0gbjsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICB3b3JrW2wxICsgaV0gPSAwO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoaiA9IG5hY3QgKyAxOyBqIDw9IG47IGogPSBqICsgMSkge1xuICAgICAgICAgICAgZm9yIChpID0gMTsgaSA8PSBuOyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgICAgICB3b3JrW2wxICsgaV0gPSB3b3JrW2wxICsgaV0gKyBkbWF0W2ldW2pdICogd29ya1tqXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHQxaW5mID0gdHJ1ZTtcbiAgICAgICAgZm9yIChpID0gbmFjdDsgaSA+PSAxOyBpID0gaSAtIDEpIHtcbiAgICAgICAgICAgIHN1bSA9IHdvcmtbaV07XG4gICAgICAgICAgICBsID0gaXdybSArIChpICogKGkgKyAzKSkgLyAyO1xuICAgICAgICAgICAgbDEgPSBsIC0gaTtcbiAgICAgICAgICAgIGZvciAoaiA9IGkgKyAxOyBqIDw9IG5hY3Q7IGogPSBqICsgMSkge1xuICAgICAgICAgICAgICAgIHN1bSA9IHN1bSAtIHdvcmtbbF0gKiB3b3JrW2l3cnYgKyBqXTtcbiAgICAgICAgICAgICAgICBsID0gbCArIGo7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdW0gPSBzdW0gLyB3b3JrW2wxXTtcbiAgICAgICAgICAgIHdvcmtbaXdydiArIGldID0gc3VtO1xuICAgICAgICAgICAgaWYgKGlhY3RbaV0gPCBtZXEpIHtcbiAgICAgICAgICAgICAgICAvLyBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzdW0gPCAwKSB7XG4gICAgICAgICAgICAgICAgLy8gY29udGludWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0MWluZiA9IGZhbHNlO1xuICAgICAgICAgICAgaXQxID0gaTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdDFpbmYpIHtcbiAgICAgICAgICAgIHQxID0gd29ya1tpd3V2ICsgaXQxXSAvIHdvcmtbaXdydiArIGl0MV07XG4gICAgICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IG5hY3Q7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgIGlmIChpYWN0W2ldIDwgbWVxKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHdvcmtbaXdydiArIGldIDwgMCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRlbXAgPSB3b3JrW2l3dXYgKyBpXSAvIHdvcmtbaXdydiArIGldO1xuICAgICAgICAgICAgICAgIGlmICh0ZW1wIDwgdDEpIHtcbiAgICAgICAgICAgICAgICAgICAgdDEgPSB0ZW1wO1xuICAgICAgICAgICAgICAgICAgICBpdDEgPSBpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHN1bSA9IDA7XG4gICAgICAgIGZvciAoaSA9IGl3enYgKyAxOyBpIDw9IGl3enYgKyBuOyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgIHN1bSA9IHN1bSArIHdvcmtbaV0gKiB3b3JrW2ldO1xuICAgICAgICB9XG4gICAgICAgIGlmIChNYXRoLmFicyhzdW0pIDw9IHZzbWFsbCkge1xuICAgICAgICAgICAgaWYgKHQxaW5mKSB7XG4gICAgICAgICAgICAgICAgaWVyclsxXSA9IDE7XG4gICAgICAgICAgICAgICAgLy8gR09UTyA5OTlcbiAgICAgICAgICAgICAgICByZXR1cm4gOTk5O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IG5hY3Q7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgICAgICB3b3JrW2l3dXYgKyBpXSA9IHdvcmtbaXd1diArIGldIC0gdDEgKiB3b3JrW2l3cnYgKyBpXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgd29ya1tpd3V2ICsgbmFjdCArIDFdID0gd29ya1tpd3V2ICsgbmFjdCArIDFdICsgdDE7XG4gICAgICAgICAgICAgICAgLy8gR09UTyA3MDBcbiAgICAgICAgICAgICAgICByZXR1cm4gNzAwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3VtID0gMDtcbiAgICAgICAgICAgIGZvciAoaSA9IDE7IGkgPD0gbjsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICAgICAgc3VtID0gc3VtICsgd29ya1tpd3p2ICsgaV0gKiBhbWF0W2ldW252bF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0dCA9IC13b3JrW2l3c3YgKyBudmxdIC8gc3VtO1xuICAgICAgICAgICAgdDJtaW4gPSB0cnVlO1xuICAgICAgICAgICAgaWYgKCF0MWluZikge1xuICAgICAgICAgICAgICAgIGlmICh0MSA8IHR0KSB7XG4gICAgICAgICAgICAgICAgICAgIHR0ID0gdDE7XG4gICAgICAgICAgICAgICAgICAgIHQybWluID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IG47IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgIHNvbFtpXSA9IHNvbFtpXSArIHR0ICogd29ya1tpd3p2ICsgaV07XG4gICAgICAgICAgICAgICAgaWYgKE1hdGguYWJzKHNvbFtpXSkgPCB2c21hbGwpIHtcbiAgICAgICAgICAgICAgICAgICAgc29sW2ldID0gMDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNydmFsWzFdID0gY3J2YWxbMV0gKyB0dCAqIHN1bSAqICh0dCAvIDIgKyB3b3JrW2l3dXYgKyBuYWN0ICsgMV0pO1xuICAgICAgICAgICAgZm9yIChpID0gMTsgaSA8PSBuYWN0OyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgICAgICB3b3JrW2l3dXYgKyBpXSA9IHdvcmtbaXd1diArIGldIC0gdHQgKiB3b3JrW2l3cnYgKyBpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHdvcmtbaXd1diArIG5hY3QgKyAxXSA9IHdvcmtbaXd1diArIG5hY3QgKyAxXSArIHR0O1xuXG4gICAgICAgICAgICBpZiAodDJtaW4pIHtcbiAgICAgICAgICAgICAgICBuYWN0ID0gbmFjdCArIDE7XG4gICAgICAgICAgICAgICAgaWFjdFtuYWN0XSA9IG52bDtcblxuICAgICAgICAgICAgICAgIGwgPSBpd3JtICsgKChuYWN0IC0gMSkgKiBuYWN0KSAvIDIgKyAxO1xuICAgICAgICAgICAgICAgIGZvciAoaSA9IDE7IGkgPD0gbmFjdCAtIDE7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgICAgICB3b3JrW2xdID0gd29ya1tpXTtcbiAgICAgICAgICAgICAgICAgICAgbCA9IGwgKyAxO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChuYWN0ID09PSBuKSB7XG4gICAgICAgICAgICAgICAgICAgIHdvcmtbbF0gPSB3b3JrW25dO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoaSA9IG47IGkgPj0gbmFjdCArIDE7IGkgPSBpIC0gMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHdvcmtbaV0gPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGdjID0gTWF0aC5tYXgoTWF0aC5hYnMod29ya1tpIC0gMV0pLCBNYXRoLmFicyh3b3JrW2ldKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBncyA9IE1hdGgubWluKE1hdGguYWJzKHdvcmtbaSAtIDFdKSwgTWF0aC5hYnMod29ya1tpXSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHdvcmtbaSAtIDFdID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZW1wID0gTWF0aC5hYnMoZ2MgKiBNYXRoLnNxcnQoMSArIGdzICogZ3MgLyAoZ2MgKiBnYykpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVtcCA9IC1NYXRoLmFicyhnYyAqIE1hdGguc3FydCgxICsgZ3MgKiBncyAvIChnYyAqIGdjKSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZ2MgPSB3b3JrW2kgLSAxXSAvIHRlbXA7XG4gICAgICAgICAgICAgICAgICAgICAgICBncyA9IHdvcmtbaV0gLyB0ZW1wO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZ2MgPT09IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChnYyA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtbaSAtIDFdID0gZ3MgKiB0ZW1wO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoaiA9IDE7IGogPD0gbjsgaiA9IGogKyAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbXAgPSBkbWF0W2pdW2kgLSAxXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG1hdFtqXVtpIC0gMV0gPSBkbWF0W2pdW2ldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkbWF0W2pdW2ldID0gdGVtcDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtbaSAtIDFdID0gdGVtcDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBudSA9IGdzIC8gKDEgKyBnYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChqID0gMTsgaiA8PSBuOyBqID0gaiArIDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVtcCA9IGdjICogZG1hdFtqXVtpIC0gMV0gKyBncyAqIGRtYXRbal1baV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRtYXRbal1baV0gPSBudSAqIChkbWF0W2pdW2kgLSAxXSArIHRlbXApIC0gZG1hdFtqXVtpXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG1hdFtqXVtpIC0gMV0gPSB0ZW1wO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHdvcmtbbF0gPSB3b3JrW25hY3RdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3VtID0gLWJ2ZWNbbnZsXTtcbiAgICAgICAgICAgICAgICBmb3IgKGogPSAxOyBqIDw9IG47IGogPSBqICsgMSkge1xuICAgICAgICAgICAgICAgICAgICBzdW0gPSBzdW0gKyBzb2xbal0gKiBhbWF0W2pdW252bF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChudmwgPiBtZXEpIHtcbiAgICAgICAgICAgICAgICAgICAgd29ya1tpd3N2ICsgbnZsXSA9IHN1bTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB3b3JrW2l3c3YgKyBudmxdID0gLU1hdGguYWJzKHN1bSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdW0gPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGogPSAxOyBqIDw9IG47IGogPSBqICsgMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFtYXRbal1bbnZsXSA9IC1hbWF0W2pdW252bF07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBidmVjW252bF0gPSAtYnZlY1tudmxdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIEdPVE8gNzAwXG4gICAgICAgICAgICAgICAgcmV0dXJuIDcwMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZuX2dvdG9fNzk3KCkge1xuICAgICAgICBsID0gaXdybSArIChpdDEgKiAoaXQxICsgMSkpIC8gMiArIDE7XG4gICAgICAgIGwxID0gbCArIGl0MTtcbiAgICAgICAgaWYgKHdvcmtbbDFdID09PSAwKSB7XG4gICAgICAgICAgICAvLyBHT1RPIDc5OFxuICAgICAgICAgICAgcmV0dXJuIDc5ODtcbiAgICAgICAgfVxuICAgICAgICBnYyA9IE1hdGgubWF4KE1hdGguYWJzKHdvcmtbbDEgLSAxXSksIE1hdGguYWJzKHdvcmtbbDFdKSk7XG4gICAgICAgIGdzID0gTWF0aC5taW4oTWF0aC5hYnMod29ya1tsMSAtIDFdKSwgTWF0aC5hYnMod29ya1tsMV0pKTtcbiAgICAgICAgaWYgKHdvcmtbbDEgLSAxXSA+PSAwKSB7XG4gICAgICAgICAgICB0ZW1wID0gTWF0aC5hYnMoZ2MgKiBNYXRoLnNxcnQoMSArIGdzICogZ3MgLyAoZ2MgKiBnYykpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRlbXAgPSAtTWF0aC5hYnMoZ2MgKiBNYXRoLnNxcnQoMSArIGdzICogZ3MgLyAoZ2MgKiBnYykpKTtcbiAgICAgICAgfVxuICAgICAgICBnYyA9IHdvcmtbbDEgLSAxXSAvIHRlbXA7XG4gICAgICAgIGdzID0gd29ya1tsMV0gLyB0ZW1wO1xuXG4gICAgICAgIGlmIChnYyA9PT0gMSkge1xuICAgICAgICAgICAgLy8gR09UTyA3OThcbiAgICAgICAgICAgIHJldHVybiA3OTg7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGdjID09PSAwKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSBpdDEgKyAxOyBpIDw9IG5hY3Q7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgIHRlbXAgPSB3b3JrW2wxIC0gMV07XG4gICAgICAgICAgICAgICAgd29ya1tsMSAtIDFdID0gd29ya1tsMV07XG4gICAgICAgICAgICAgICAgd29ya1tsMV0gPSB0ZW1wO1xuICAgICAgICAgICAgICAgIGwxID0gbDEgKyBpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChpID0gMTsgaSA8PSBuOyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgICAgICB0ZW1wID0gZG1hdFtpXVtpdDFdO1xuICAgICAgICAgICAgICAgIGRtYXRbaV1baXQxXSA9IGRtYXRbaV1baXQxICsgMV07XG4gICAgICAgICAgICAgICAgZG1hdFtpXVtpdDEgKyAxXSA9IHRlbXA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBudSA9IGdzIC8gKDEgKyBnYyk7XG4gICAgICAgICAgICBmb3IgKGkgPSBpdDEgKyAxOyBpIDw9IG5hY3Q7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgIHRlbXAgPSBnYyAqIHdvcmtbbDEgLSAxXSArIGdzICogd29ya1tsMV07XG4gICAgICAgICAgICAgICAgd29ya1tsMV0gPSBudSAqICh3b3JrW2wxIC0gMV0gKyB0ZW1wKSAtIHdvcmtbbDFdO1xuICAgICAgICAgICAgICAgIHdvcmtbbDEgLSAxXSA9IHRlbXA7XG4gICAgICAgICAgICAgICAgbDEgPSBsMSArIGk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IG47IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgICAgIHRlbXAgPSBnYyAqIGRtYXRbaV1baXQxXSArIGdzICogZG1hdFtpXVtpdDEgKyAxXTtcbiAgICAgICAgICAgICAgICBkbWF0W2ldW2l0MSArIDFdID0gbnUgKiAoZG1hdFtpXVtpdDFdICsgdGVtcCkgLSBkbWF0W2ldW2l0MSArIDFdO1xuICAgICAgICAgICAgICAgIGRtYXRbaV1baXQxXSA9IHRlbXA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbl9nb3RvXzc5OCgpIHtcbiAgICAgICAgbDEgPSBsIC0gaXQxO1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IGl0MTsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICB3b3JrW2wxXSA9IHdvcmtbbF07XG4gICAgICAgICAgICBsID0gbCArIDE7XG4gICAgICAgICAgICBsMSA9IGwxICsgMTtcbiAgICAgICAgfVxuXG4gICAgICAgIHdvcmtbaXd1diArIGl0MV0gPSB3b3JrW2l3dXYgKyBpdDEgKyAxXTtcbiAgICAgICAgaWFjdFtpdDFdID0gaWFjdFtpdDEgKyAxXTtcbiAgICAgICAgaXQxID0gaXQxICsgMTtcbiAgICAgICAgaWYgKGl0MSA8IG5hY3QpIHtcbiAgICAgICAgICAgIC8vIEdPVE8gNzk3XG4gICAgICAgICAgICByZXR1cm4gNzk3O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm5fZ290b183OTkoKSB7XG4gICAgICAgIHdvcmtbaXd1diArIG5hY3RdID0gd29ya1tpd3V2ICsgbmFjdCArIDFdO1xuICAgICAgICB3b3JrW2l3dXYgKyBuYWN0ICsgMV0gPSAwO1xuICAgICAgICBpYWN0W25hY3RdID0gMDtcbiAgICAgICAgbmFjdCA9IG5hY3QgLSAxO1xuICAgICAgICBpdGVyWzJdID0gaXRlclsyXSArIDE7XG5cbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgZ28gPSAwO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGdvID0gZm5fZ290b181MCgpO1xuICAgICAgICBpZiAoZ28gPT09IDk5OSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICBnbyA9IGZuX2dvdG9fNTUoKTtcbiAgICAgICAgICAgIGlmIChnbyA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGdvID09PSA5OTkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZ28gPT09IDcwMCkge1xuICAgICAgICAgICAgICAgIGlmIChpdDEgPT09IG5hY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgZm5fZ290b183OTkoKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm5fZ290b183OTcoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdvID0gZm5fZ290b183OTgoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChnbyAhPT0gNzk3KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZm5fZ290b183OTkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbn1cblxuZnVuY3Rpb24gc29sdmVRUChEbWF0LCBkdmVjLCBBbWF0LCBidmVjLCBtZXEsIGZhY3Rvcml6ZWQpIHtcbiAgICBEbWF0ID0gYmFzZTB0bzEoRG1hdCk7XG4gICAgZHZlYyA9IGJhc2UwdG8xKGR2ZWMpO1xuICAgIEFtYXQgPSBiYXNlMHRvMShBbWF0KTtcbiAgICB2YXIgaSwgbiwgcSxcbiAgICAgICAgbmFjdCwgcixcbiAgICAgICAgY3J2YWwgPSBbXSwgaWFjdCA9IFtdLCBzb2wgPSBbXSwgd29yayA9IFtdLCBpdGVyID0gW10sXG4gICAgICAgIG1lc3NhZ2U7XG5cbiAgICBtZXEgPSBtZXEgfHwgMDtcbiAgICBmYWN0b3JpemVkID0gZmFjdG9yaXplZCA/IGJhc2UwdG8xKGZhY3Rvcml6ZWQpIDogW3VuZGVmaW5lZCwgMF07XG4gICAgYnZlYyA9IGJ2ZWMgPyBiYXNlMHRvMShidmVjKSA6IFtdO1xuXG4gICAgLy8gSW4gRm9ydHJhbiB0aGUgYXJyYXkgaW5kZXggc3RhcnRzIGZyb20gMVxuICAgIG4gPSBEbWF0Lmxlbmd0aCAtIDE7XG4gICAgcSA9IEFtYXRbMV0ubGVuZ3RoIC0gMTtcblxuICAgIGlmICghYnZlYykge1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDw9IHE7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgYnZlY1tpXSA9IDA7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZm9yIChpID0gMTsgaSA8PSBxOyBpID0gaSArIDEpIHtcbiAgICAgICAgaWFjdFtpXSA9IDA7XG4gICAgfVxuICAgIG5hY3QgPSAwO1xuICAgIHIgPSBNYXRoLm1pbihuLCBxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDw9IG47IGkgPSBpICsgMSkge1xuICAgICAgICBzb2xbaV0gPSAwO1xuICAgIH1cbiAgICBjcnZhbFsxXSA9IDA7XG4gICAgZm9yIChpID0gMTsgaSA8PSAoMiAqIG4gKyAociAqIChyICsgNSkpIC8gMiArIDIgKiBxICsgMSk7IGkgPSBpICsgMSkge1xuICAgICAgICB3b3JrW2ldID0gMDtcbiAgICB9XG4gICAgZm9yIChpID0gMTsgaSA8PSAyOyBpID0gaSArIDEpIHtcbiAgICAgICAgaXRlcltpXSA9IDA7XG4gICAgfVxuXG4gICAgcXBnZW4yKERtYXQsIGR2ZWMsIG4sIG4sIHNvbCwgY3J2YWwsIEFtYXQsXG4gICAgICAgIGJ2ZWMsIG4sIHEsIG1lcSwgaWFjdCwgbmFjdCwgaXRlciwgd29yaywgZmFjdG9yaXplZCk7XG5cbiAgICBtZXNzYWdlID0gXCJcIjtcbiAgICBpZiAoZmFjdG9yaXplZFsxXSA9PT0gMSkge1xuICAgICAgICBtZXNzYWdlID0gXCJjb25zdHJhaW50cyBhcmUgaW5jb25zaXN0ZW50LCBubyBzb2x1dGlvbiFcIjtcbiAgICB9XG4gICAgaWYgKGZhY3Rvcml6ZWRbMV0gPT09IDIpIHtcbiAgICAgICAgbWVzc2FnZSA9IFwibWF0cml4IEQgaW4gcXVhZHJhdGljIGZ1bmN0aW9uIGlzIG5vdCBwb3NpdGl2ZSBkZWZpbml0ZSFcIjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzb2x1dGlvbjogYmFzZTF0bzAoc29sKSxcbiAgICAgICAgdmFsdWU6IGJhc2UxdG8wKGNydmFsKSxcbiAgICAgICAgdW5jb25zdHJhaW5lZF9zb2x1dGlvbjogYmFzZTF0bzAoZHZlYyksXG4gICAgICAgIGl0ZXJhdGlvbnM6IGJhc2UxdG8wKGl0ZXIpLFxuICAgICAgICBpYWN0OiBiYXNlMXRvMChpYWN0KSxcbiAgICAgICAgbWVzc2FnZTogbWVzc2FnZVxuICAgIH07XG59XG5leHBvcnRzLnNvbHZlUVAgPSBzb2x2ZVFQO1xufShudW1lcmljKSk7XG4vKlxyXG5TaGFudGkgUmFvIHNlbnQgbWUgdGhpcyByb3V0aW5lIGJ5IHByaXZhdGUgZW1haWwuIEkgaGFkIHRvIG1vZGlmeSBpdFxyXG5zbGlnaHRseSB0byB3b3JrIG9uIEFycmF5cyBpbnN0ZWFkIG9mIHVzaW5nIGEgTWF0cml4IG9iamVjdC5cclxuSXQgaXMgYXBwYXJlbnRseSB0cmFuc2xhdGVkIGZyb20gaHR0cDovL3N0aXRjaHBhbm9yYW1hLnNvdXJjZWZvcmdlLm5ldC9QeXRob24vc3ZkLnB5XHJcbiovXHJcblxyXG5udW1lcmljLnN2ZD0gZnVuY3Rpb24gc3ZkKEEpIHtcclxuICAgIHZhciB0ZW1wO1xyXG4vL0NvbXB1dGUgdGhlIHRoaW4gU1ZEIGZyb20gRy4gSC4gR29sdWIgYW5kIEMuIFJlaW5zY2gsIE51bWVyLiBNYXRoLiAxNCwgNDAzLTQyMCAoMTk3MClcclxuXHR2YXIgcHJlYz0gbnVtZXJpYy5lcHNpbG9uOyAvL01hdGgucG93KDIsLTUyKSAvLyBhc3N1bWVzIGRvdWJsZSBwcmVjXHJcblx0dmFyIHRvbGVyYW5jZT0gMS5lLTY0L3ByZWM7XHJcblx0dmFyIGl0bWF4PSA1MDtcclxuXHR2YXIgYz0wO1xyXG5cdHZhciBpPTA7XHJcblx0dmFyIGo9MDtcclxuXHR2YXIgaz0wO1xyXG5cdHZhciBsPTA7XHJcblx0XHJcblx0dmFyIHU9IG51bWVyaWMuY2xvbmUoQSk7XHJcblx0dmFyIG09IHUubGVuZ3RoO1xyXG5cdFxyXG5cdHZhciBuPSB1WzBdLmxlbmd0aDtcclxuXHRcclxuXHRpZiAobSA8IG4pIHRocm93IFwiTmVlZCBtb3JlIHJvd3MgdGhhbiBjb2x1bW5zXCJcclxuXHRcclxuXHR2YXIgZSA9IG5ldyBBcnJheShuKTtcclxuXHR2YXIgcSA9IG5ldyBBcnJheShuKTtcclxuXHRmb3IgKGk9MDsgaTxuOyBpKyspIGVbaV0gPSBxW2ldID0gMC4wO1xyXG5cdHZhciB2ID0gbnVtZXJpYy5yZXAoW24sbl0sMCk7XHJcbi8vXHR2Lnplcm8oKTtcclxuXHRcclxuIFx0ZnVuY3Rpb24gcHl0aGFnKGEsYilcclxuIFx0e1xyXG5cdFx0YSA9IE1hdGguYWJzKGEpXHJcblx0XHRiID0gTWF0aC5hYnMoYilcclxuXHRcdGlmIChhID4gYilcclxuXHRcdFx0cmV0dXJuIGEqTWF0aC5zcXJ0KDEuMCsoYipiL2EvYSkpXHJcblx0XHRlbHNlIGlmIChiID09IDAuMCkgXHJcblx0XHRcdHJldHVybiBhXHJcblx0XHRyZXR1cm4gYipNYXRoLnNxcnQoMS4wKyhhKmEvYi9iKSlcclxuXHR9XHJcblxyXG5cdC8vSG91c2Vob2xkZXIncyByZWR1Y3Rpb24gdG8gYmlkaWFnb25hbCBmb3JtXHJcblxyXG5cdHZhciBmPSAwLjA7XHJcblx0dmFyIGc9IDAuMDtcclxuXHR2YXIgaD0gMC4wO1xyXG5cdHZhciB4PSAwLjA7XHJcblx0dmFyIHk9IDAuMDtcclxuXHR2YXIgej0gMC4wO1xyXG5cdHZhciBzPSAwLjA7XHJcblx0XHJcblx0Zm9yIChpPTA7IGkgPCBuOyBpKyspXHJcblx0e1x0XHJcblx0XHRlW2ldPSBnO1xyXG5cdFx0cz0gMC4wO1xyXG5cdFx0bD0gaSsxO1xyXG5cdFx0Zm9yIChqPWk7IGogPCBtOyBqKyspIFxyXG5cdFx0XHRzICs9ICh1W2pdW2ldKnVbal1baV0pO1xyXG5cdFx0aWYgKHMgPD0gdG9sZXJhbmNlKVxyXG5cdFx0XHRnPSAwLjA7XHJcblx0XHRlbHNlXHJcblx0XHR7XHRcclxuXHRcdFx0Zj0gdVtpXVtpXTtcclxuXHRcdFx0Zz0gTWF0aC5zcXJ0KHMpO1xyXG5cdFx0XHRpZiAoZiA+PSAwLjApIGc9IC1nO1xyXG5cdFx0XHRoPSBmKmctc1xyXG5cdFx0XHR1W2ldW2ldPWYtZztcclxuXHRcdFx0Zm9yIChqPWw7IGogPCBuOyBqKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHRzPSAwLjBcclxuXHRcdFx0XHRmb3IgKGs9aTsgayA8IG07IGsrKykgXHJcblx0XHRcdFx0XHRzICs9IHVba11baV0qdVtrXVtqXVxyXG5cdFx0XHRcdGY9IHMvaFxyXG5cdFx0XHRcdGZvciAoaz1pOyBrIDwgbTsgaysrKSBcclxuXHRcdFx0XHRcdHVba11bal0rPWYqdVtrXVtpXVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRxW2ldPSBnXHJcblx0XHRzPSAwLjBcclxuXHRcdGZvciAoaj1sOyBqIDwgbjsgaisrKSBcclxuXHRcdFx0cz0gcyArIHVbaV1bal0qdVtpXVtqXVxyXG5cdFx0aWYgKHMgPD0gdG9sZXJhbmNlKVxyXG5cdFx0XHRnPSAwLjBcclxuXHRcdGVsc2VcclxuXHRcdHtcdFxyXG5cdFx0XHRmPSB1W2ldW2krMV1cclxuXHRcdFx0Zz0gTWF0aC5zcXJ0KHMpXHJcblx0XHRcdGlmIChmID49IDAuMCkgZz0gLWdcclxuXHRcdFx0aD0gZipnIC0gc1xyXG5cdFx0XHR1W2ldW2krMV0gPSBmLWc7XHJcblx0XHRcdGZvciAoaj1sOyBqIDwgbjsgaisrKSBlW2pdPSB1W2ldW2pdL2hcclxuXHRcdFx0Zm9yIChqPWw7IGogPCBtOyBqKyspXHJcblx0XHRcdHtcdFxyXG5cdFx0XHRcdHM9MC4wXHJcblx0XHRcdFx0Zm9yIChrPWw7IGsgPCBuOyBrKyspIFxyXG5cdFx0XHRcdFx0cyArPSAodVtqXVtrXSp1W2ldW2tdKVxyXG5cdFx0XHRcdGZvciAoaz1sOyBrIDwgbjsgaysrKSBcclxuXHRcdFx0XHRcdHVbal1ba10rPXMqZVtrXVxyXG5cdFx0XHR9XHRcclxuXHRcdH1cclxuXHRcdHk9IE1hdGguYWJzKHFbaV0pK01hdGguYWJzKGVbaV0pXHJcblx0XHRpZiAoeT54KSBcclxuXHRcdFx0eD15XHJcblx0fVxyXG5cdFxyXG5cdC8vIGFjY3VtdWxhdGlvbiBvZiByaWdodCBoYW5kIGd0cmFuc2Zvcm1hdGlvbnNcclxuXHRmb3IgKGk9bi0xOyBpICE9IC0xOyBpKz0gLTEpXHJcblx0e1x0XHJcblx0XHRpZiAoZyAhPSAwLjApXHJcblx0XHR7XHJcblx0XHQgXHRoPSBnKnVbaV1baSsxXVxyXG5cdFx0XHRmb3IgKGo9bDsgaiA8IG47IGorKykgXHJcblx0XHRcdFx0dltqXVtpXT11W2ldW2pdL2hcclxuXHRcdFx0Zm9yIChqPWw7IGogPCBuOyBqKyspXHJcblx0XHRcdHtcdFxyXG5cdFx0XHRcdHM9MC4wXHJcblx0XHRcdFx0Zm9yIChrPWw7IGsgPCBuOyBrKyspIFxyXG5cdFx0XHRcdFx0cyArPSB1W2ldW2tdKnZba11bal1cclxuXHRcdFx0XHRmb3IgKGs9bDsgayA8IG47IGsrKykgXHJcblx0XHRcdFx0XHR2W2tdW2pdKz0ocyp2W2tdW2ldKVxyXG5cdFx0XHR9XHRcclxuXHRcdH1cclxuXHRcdGZvciAoaj1sOyBqIDwgbjsgaisrKVxyXG5cdFx0e1xyXG5cdFx0XHR2W2ldW2pdID0gMDtcclxuXHRcdFx0dltqXVtpXSA9IDA7XHJcblx0XHR9XHJcblx0XHR2W2ldW2ldID0gMTtcclxuXHRcdGc9IGVbaV1cclxuXHRcdGw9IGlcclxuXHR9XHJcblx0XHJcblx0Ly8gYWNjdW11bGF0aW9uIG9mIGxlZnQgaGFuZCB0cmFuc2Zvcm1hdGlvbnNcclxuXHRmb3IgKGk9bi0xOyBpICE9IC0xOyBpKz0gLTEpXHJcblx0e1x0XHJcblx0XHRsPSBpKzFcclxuXHRcdGc9IHFbaV1cclxuXHRcdGZvciAoaj1sOyBqIDwgbjsgaisrKSBcclxuXHRcdFx0dVtpXVtqXSA9IDA7XHJcblx0XHRpZiAoZyAhPSAwLjApXHJcblx0XHR7XHJcblx0XHRcdGg9IHVbaV1baV0qZ1xyXG5cdFx0XHRmb3IgKGo9bDsgaiA8IG47IGorKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHM9MC4wXHJcblx0XHRcdFx0Zm9yIChrPWw7IGsgPCBtOyBrKyspIHMgKz0gdVtrXVtpXSp1W2tdW2pdO1xyXG5cdFx0XHRcdGY9IHMvaFxyXG5cdFx0XHRcdGZvciAoaz1pOyBrIDwgbTsgaysrKSB1W2tdW2pdKz1mKnVba11baV07XHJcblx0XHRcdH1cclxuXHRcdFx0Zm9yIChqPWk7IGogPCBtOyBqKyspIHVbal1baV0gPSB1W2pdW2ldL2c7XHJcblx0XHR9XHJcblx0XHRlbHNlXHJcblx0XHRcdGZvciAoaj1pOyBqIDwgbTsgaisrKSB1W2pdW2ldID0gMDtcclxuXHRcdHVbaV1baV0gKz0gMTtcclxuXHR9XHJcblx0XHJcblx0Ly8gZGlhZ29uYWxpemF0aW9uIG9mIHRoZSBiaWRpYWdvbmFsIGZvcm1cclxuXHRwcmVjPSBwcmVjKnhcclxuXHRmb3IgKGs9bi0xOyBrICE9IC0xOyBrKz0gLTEpXHJcblx0e1xyXG5cdFx0Zm9yICh2YXIgaXRlcmF0aW9uPTA7IGl0ZXJhdGlvbiA8IGl0bWF4OyBpdGVyYXRpb24rKylcclxuXHRcdHtcdC8vIHRlc3QgZiBzcGxpdHRpbmdcclxuXHRcdFx0dmFyIHRlc3RfY29udmVyZ2VuY2UgPSBmYWxzZVxyXG5cdFx0XHRmb3IgKGw9azsgbCAhPSAtMTsgbCs9IC0xKVxyXG5cdFx0XHR7XHRcclxuXHRcdFx0XHRpZiAoTWF0aC5hYnMoZVtsXSkgPD0gcHJlYylcclxuXHRcdFx0XHR7XHR0ZXN0X2NvbnZlcmdlbmNlPSB0cnVlXHJcblx0XHRcdFx0XHRicmVhayBcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKE1hdGguYWJzKHFbbC0xXSkgPD0gcHJlYylcclxuXHRcdFx0XHRcdGJyZWFrIFxyXG5cdFx0XHR9XHJcblx0XHRcdGlmICghdGVzdF9jb252ZXJnZW5jZSlcclxuXHRcdFx0e1x0Ly8gY2FuY2VsbGF0aW9uIG9mIGVbbF0gaWYgbD4wXHJcblx0XHRcdFx0Yz0gMC4wXHJcblx0XHRcdFx0cz0gMS4wXHJcblx0XHRcdFx0dmFyIGwxPSBsLTFcclxuXHRcdFx0XHRmb3IgKGkgPWw7IGk8aysxOyBpKyspXHJcblx0XHRcdFx0e1x0XHJcblx0XHRcdFx0XHRmPSBzKmVbaV1cclxuXHRcdFx0XHRcdGVbaV09IGMqZVtpXVxyXG5cdFx0XHRcdFx0aWYgKE1hdGguYWJzKGYpIDw9IHByZWMpXHJcblx0XHRcdFx0XHRcdGJyZWFrXHJcblx0XHRcdFx0XHRnPSBxW2ldXHJcblx0XHRcdFx0XHRoPSBweXRoYWcoZixnKVxyXG5cdFx0XHRcdFx0cVtpXT0gaFxyXG5cdFx0XHRcdFx0Yz0gZy9oXHJcblx0XHRcdFx0XHRzPSAtZi9oXHJcblx0XHRcdFx0XHRmb3IgKGo9MDsgaiA8IG07IGorKylcclxuXHRcdFx0XHRcdHtcdFxyXG5cdFx0XHRcdFx0XHR5PSB1W2pdW2wxXVxyXG5cdFx0XHRcdFx0XHR6PSB1W2pdW2ldXHJcblx0XHRcdFx0XHRcdHVbal1bbDFdID0gIHkqYysoeipzKVxyXG5cdFx0XHRcdFx0XHR1W2pdW2ldID0gLXkqcysoeipjKVxyXG5cdFx0XHRcdFx0fSBcclxuXHRcdFx0XHR9XHRcclxuXHRcdFx0fVxyXG5cdFx0XHQvLyB0ZXN0IGYgY29udmVyZ2VuY2VcclxuXHRcdFx0ej0gcVtrXVxyXG5cdFx0XHRpZiAobD09IGspXHJcblx0XHRcdHtcdC8vY29udmVyZ2VuY2VcclxuXHRcdFx0XHRpZiAoejwwLjApXHJcblx0XHRcdFx0e1x0Ly9xW2tdIGlzIG1hZGUgbm9uLW5lZ2F0aXZlXHJcblx0XHRcdFx0XHRxW2tdPSAtelxyXG5cdFx0XHRcdFx0Zm9yIChqPTA7IGogPCBuOyBqKyspXHJcblx0XHRcdFx0XHRcdHZbal1ba10gPSAtdltqXVtrXVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRicmVhayAgLy9icmVhayBvdXQgb2YgaXRlcmF0aW9uIGxvb3AgYW5kIG1vdmUgb24gdG8gbmV4dCBrIHZhbHVlXHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKGl0ZXJhdGlvbiA+PSBpdG1heC0xKVxyXG5cdFx0XHRcdHRocm93ICdFcnJvcjogbm8gY29udmVyZ2VuY2UuJ1xyXG5cdFx0XHQvLyBzaGlmdCBmcm9tIGJvdHRvbSAyeDIgbWlub3JcclxuXHRcdFx0eD0gcVtsXVxyXG5cdFx0XHR5PSBxW2stMV1cclxuXHRcdFx0Zz0gZVtrLTFdXHJcblx0XHRcdGg9IGVba11cclxuXHRcdFx0Zj0gKCh5LXopKih5K3opKyhnLWgpKihnK2gpKS8oMi4wKmgqeSlcclxuXHRcdFx0Zz0gcHl0aGFnKGYsMS4wKVxyXG5cdFx0XHRpZiAoZiA8IDAuMClcclxuXHRcdFx0XHRmPSAoKHgteikqKHgreikraCooeS8oZi1nKS1oKSkveFxyXG5cdFx0XHRlbHNlXHJcblx0XHRcdFx0Zj0gKCh4LXopKih4K3opK2gqKHkvKGYrZyktaCkpL3hcclxuXHRcdFx0Ly8gbmV4dCBRUiB0cmFuc2Zvcm1hdGlvblxyXG5cdFx0XHRjPSAxLjBcclxuXHRcdFx0cz0gMS4wXHJcblx0XHRcdGZvciAoaT1sKzE7IGk8IGsrMTsgaSsrKVxyXG5cdFx0XHR7XHRcclxuXHRcdFx0XHRnPSBlW2ldXHJcblx0XHRcdFx0eT0gcVtpXVxyXG5cdFx0XHRcdGg9IHMqZ1xyXG5cdFx0XHRcdGc9IGMqZ1xyXG5cdFx0XHRcdHo9IHB5dGhhZyhmLGgpXHJcblx0XHRcdFx0ZVtpLTFdPSB6XHJcblx0XHRcdFx0Yz0gZi96XHJcblx0XHRcdFx0cz0gaC96XHJcblx0XHRcdFx0Zj0geCpjK2cqc1xyXG5cdFx0XHRcdGc9IC14KnMrZypjXHJcblx0XHRcdFx0aD0geSpzXHJcblx0XHRcdFx0eT0geSpjXHJcblx0XHRcdFx0Zm9yIChqPTA7IGogPCBuOyBqKyspXHJcblx0XHRcdFx0e1x0XHJcblx0XHRcdFx0XHR4PSB2W2pdW2ktMV1cclxuXHRcdFx0XHRcdHo9IHZbal1baV1cclxuXHRcdFx0XHRcdHZbal1baS0xXSA9IHgqYyt6KnNcclxuXHRcdFx0XHRcdHZbal1baV0gPSAteCpzK3oqY1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR6PSBweXRoYWcoZixoKVxyXG5cdFx0XHRcdHFbaS0xXT0gelxyXG5cdFx0XHRcdGM9IGYvelxyXG5cdFx0XHRcdHM9IGgvelxyXG5cdFx0XHRcdGY9IGMqZytzKnlcclxuXHRcdFx0XHR4PSAtcypnK2MqeVxyXG5cdFx0XHRcdGZvciAoaj0wOyBqIDwgbTsgaisrKVxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHk9IHVbal1baS0xXVxyXG5cdFx0XHRcdFx0ej0gdVtqXVtpXVxyXG5cdFx0XHRcdFx0dVtqXVtpLTFdID0geSpjK3oqc1xyXG5cdFx0XHRcdFx0dVtqXVtpXSA9IC15KnMreipjXHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGVbbF09IDAuMFxyXG5cdFx0XHRlW2tdPSBmXHJcblx0XHRcdHFba109IHhcclxuXHRcdH0gXHJcblx0fVxyXG5cdFx0XHJcblx0Ly92dD0gdHJhbnNwb3NlKHYpXHJcblx0Ly9yZXR1cm4gKHUscSx2dClcclxuXHRmb3IgKGk9MDtpPHEubGVuZ3RoOyBpKyspIFxyXG5cdCAgaWYgKHFbaV0gPCBwcmVjKSBxW2ldID0gMFxyXG5cdCAgXHJcblx0Ly9zb3J0IGVpZ2VudmFsdWVzXHRcclxuXHRmb3IgKGk9MDsgaTwgbjsgaSsrKVxyXG5cdHtcdCBcclxuXHQvL3dyaXRlbG4ocSlcclxuXHQgZm9yIChqPWktMTsgaiA+PSAwOyBqLS0pXHJcblx0IHtcclxuXHQgIGlmIChxW2pdIDwgcVtpXSlcclxuXHQgIHtcclxuXHQvLyAgd3JpdGVsbihpLCctJyxqKVxyXG5cdCAgIGMgPSBxW2pdXHJcblx0ICAgcVtqXSA9IHFbaV1cclxuXHQgICBxW2ldID0gY1xyXG5cdCAgIGZvcihrPTA7azx1Lmxlbmd0aDtrKyspIHsgdGVtcCA9IHVba11baV07IHVba11baV0gPSB1W2tdW2pdOyB1W2tdW2pdID0gdGVtcDsgfVxyXG5cdCAgIGZvcihrPTA7azx2Lmxlbmd0aDtrKyspIHsgdGVtcCA9IHZba11baV07IHZba11baV0gPSB2W2tdW2pdOyB2W2tdW2pdID0gdGVtcDsgfVxyXG4vL1x0ICAgdS5zd2FwQ29scyhpLGopXHJcbi8vXHQgICB2LnN3YXBDb2xzKGksailcclxuXHQgICBpID0galx0ICAgXHJcblx0ICB9XHJcblx0IH1cdFxyXG5cdH1cclxuXHRcclxuXHRyZXR1cm4ge1U6dSxTOnEsVjp2fVxyXG59O1xyXG5cclxuIiwiLypcblNpbXBsZSBKYXZhc2NyaXB0IHVuZG8gYW5kIHJlZG8uXG5odHRwczovL2dpdGh1Yi5jb20vQXJ0aHVyQ2xlbWVucy9KYXZhc2NyaXB0LVVuZG8tTWFuYWdlclxuKi9cblxuOyhmdW5jdGlvbigpIHtcblxuXHQndXNlIHN0cmljdCc7XG5cbiAgICBmdW5jdGlvbiByZW1vdmVGcm9tVG8oYXJyYXksIGZyb20sIHRvKSB7XG4gICAgICAgIGFycmF5LnNwbGljZShmcm9tLFxuICAgICAgICAgICAgIXRvIHx8XG4gICAgICAgICAgICAxICsgdG8gLSBmcm9tICsgKCEodG8gPCAwIF4gZnJvbSA+PSAwKSAmJiAodG8gPCAwIHx8IC0xKSAqIGFycmF5Lmxlbmd0aCkpO1xuICAgICAgICByZXR1cm4gYXJyYXkubGVuZ3RoO1xuICAgIH1cblxuICAgIHZhciBVbmRvTWFuYWdlciA9IGZ1bmN0aW9uKCkge1xuXG4gICAgICAgIHZhciBjb21tYW5kcyA9IFtdLFxuICAgICAgICAgICAgaW5kZXggPSAtMSxcbiAgICAgICAgICAgIGxpbWl0ID0gMCxcbiAgICAgICAgICAgIGlzRXhlY3V0aW5nID0gZmFsc2UsXG4gICAgICAgICAgICBjYWxsYmFjayxcblxuICAgICAgICAgICAgLy8gZnVuY3Rpb25zXG4gICAgICAgICAgICBleGVjdXRlO1xuXG4gICAgICAgIGV4ZWN1dGUgPSBmdW5jdGlvbihjb21tYW5kLCBhY3Rpb24pIHtcbiAgICAgICAgICAgIGlmICghY29tbWFuZCB8fCB0eXBlb2YgY29tbWFuZFthY3Rpb25dICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlzRXhlY3V0aW5nID0gdHJ1ZTtcblxuICAgICAgICAgICAgY29tbWFuZFthY3Rpb25dKCk7XG5cbiAgICAgICAgICAgIGlzRXhlY3V0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4ge1xuXG4gICAgICAgICAgICAvKlxuICAgICAgICAgICAgQWRkIGEgY29tbWFuZCB0byB0aGUgcXVldWUuXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgYWRkOiBmdW5jdGlvbiAoY29tbWFuZCkge1xuICAgICAgICAgICAgICAgIGlmIChpc0V4ZWN1dGluZykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gaWYgd2UgYXJlIGhlcmUgYWZ0ZXIgaGF2aW5nIGNhbGxlZCB1bmRvLFxuICAgICAgICAgICAgICAgIC8vIGludmFsaWRhdGUgaXRlbXMgaGlnaGVyIG9uIHRoZSBzdGFja1xuICAgICAgICAgICAgICAgIGNvbW1hbmRzLnNwbGljZShpbmRleCArIDEsIGNvbW1hbmRzLmxlbmd0aCAtIGluZGV4KTtcblxuICAgICAgICAgICAgICAgIGNvbW1hbmRzLnB1c2goY29tbWFuZCk7XG5cbiAgICAgICAgICAgICAgICAvLyBpZiBsaW1pdCBpcyBzZXQsIHJlbW92ZSBpdGVtcyBmcm9tIHRoZSBzdGFydFxuICAgICAgICAgICAgICAgIGlmIChsaW1pdCAmJiBjb21tYW5kcy5sZW5ndGggPiBsaW1pdCkge1xuICAgICAgICAgICAgICAgICAgICByZW1vdmVGcm9tVG8oY29tbWFuZHMsIDAsIC0obGltaXQrMSkpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIHNldCB0aGUgY3VycmVudCBpbmRleCB0byB0aGUgZW5kXG4gICAgICAgICAgICAgICAgaW5kZXggPSBjb21tYW5kcy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qXG4gICAgICAgICAgICBQYXNzIGEgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIG9uIHVuZG8gYW5kIHJlZG8gYWN0aW9ucy5cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBzZXRDYWxsYmFjazogZnVuY3Rpb24gKGNhbGxiYWNrRnVuYykge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrID0gY2FsbGJhY2tGdW5jO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgLypcbiAgICAgICAgICAgIFBlcmZvcm0gdW5kbzogY2FsbCB0aGUgdW5kbyBmdW5jdGlvbiBhdCB0aGUgY3VycmVudCBpbmRleCBhbmQgZGVjcmVhc2UgdGhlIGluZGV4IGJ5IDEuXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgdW5kbzogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBjb21tYW5kID0gY29tbWFuZHNbaW5kZXhdO1xuICAgICAgICAgICAgICAgIGlmICghY29tbWFuZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZXhlY3V0ZShjb21tYW5kLCBcInVuZG9cIik7XG4gICAgICAgICAgICAgICAgaW5kZXggLT0gMTtcbiAgICAgICAgICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKlxuICAgICAgICAgICAgUGVyZm9ybSByZWRvOiBjYWxsIHRoZSByZWRvIGZ1bmN0aW9uIGF0IHRoZSBuZXh0IGluZGV4IGFuZCBpbmNyZWFzZSB0aGUgaW5kZXggYnkgMS5cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICByZWRvOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvbW1hbmQgPSBjb21tYW5kc1tpbmRleCArIDFdO1xuICAgICAgICAgICAgICAgIGlmICghY29tbWFuZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZXhlY3V0ZShjb21tYW5kLCBcInJlZG9cIik7XG4gICAgICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKlxuICAgICAgICAgICAgQ2xlYXJzIHRoZSBtZW1vcnksIGxvc2luZyBhbGwgc3RvcmVkIHN0YXRlcy4gUmVzZXQgdGhlIGluZGV4LlxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNsZWFyOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByZXZfc2l6ZSA9IGNvbW1hbmRzLmxlbmd0aDtcblxuICAgICAgICAgICAgICAgIGNvbW1hbmRzID0gW107XG4gICAgICAgICAgICAgICAgaW5kZXggPSAtMTtcblxuICAgICAgICAgICAgICAgIGlmIChjYWxsYmFjayAmJiAocHJldl9zaXplID4gMCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBoYXNVbmRvOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGluZGV4ICE9PSAtMTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIGhhc1JlZG86IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5kZXggPCAoY29tbWFuZHMubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBnZXRDb21tYW5kczogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb21tYW5kcztcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIGdldEluZGV4OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBzZXRMaW1pdDogZnVuY3Rpb24gKGwpIHtcbiAgICAgICAgICAgICAgICBsaW1pdCA9IGw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfTtcblxuICAgIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykge1xuXHRcdG1vZHVsZS5leHBvcnRzID0gVW5kb01hbmFnZXI7XG5cdH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgZGVmaW5lLmFtZCA9PT0gJ29iamVjdCcgJiYgZGVmaW5lLmFtZCkge1xuXHRcdC8vIEFNRC4gUmVnaXN0ZXIgYXMgYW4gYW5vbnltb3VzIG1vZHVsZS5cblx0XHRkZWZpbmUoZnVuY3Rpb24oKSB7XG5cdFx0XHRyZXR1cm4gVW5kb01hbmFnZXI7XG5cdFx0fSk7XG5cdH0gZWxzZSB7XG5cdFx0d2luZG93LlVuZG9NYW5hZ2VyID0gVW5kb01hbmFnZXI7XG5cdH1cblxufSgpKTtcbiJdfQ==
