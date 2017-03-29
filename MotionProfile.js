(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var MotionProfile = require('./profile/motionProfile.js');


if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
	// AMD. Register as an anonymous module.
	define(function() {
		return MotionProfile;
	});
} else if (typeof module !== 'undefined' && module.exports) {
	module.exports = MotionProfile;
} else {
	window.MotionProfile = MotionProfile;
}



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

},{}]},{},[1]);
