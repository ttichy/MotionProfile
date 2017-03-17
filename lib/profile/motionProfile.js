/**
 * Creates MotionProfile. MotionProfile is a list of MotionSegments.
 * MotionSegments represent the various available segments in a profile, such as BasicSegment, AccelSegment,
 * CamSegment, IndexSegment, etc...
 *
 */
var AccelSegment = require('../segments/accelSegment');
var IndexSegment = require('../segments/indexSegment');
var LoadSegment = require('../segments/loadSegment');
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

	//undo / redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.appendSegment(segToDelete);
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
	if (this.profileLoads[loadSegment.type].findOverlappingSegment(loadSegment.initialTime, loadSegment.finalTime))
		throw new Error("New segment overlaps an existing segment");

	// find previous segment. Needed in case of insertion
	var prevSegment = this.profileLoads[loadSegment.type].getPreviousByInitialTime(loadSegment.t0);
	var prevId = null;
	if (prevSegment)
		prevId = prevSegment.id;

	if (this.profileLoads[loadSegment.type].countSegments() === 0) {
		this.profileLoads[loadSegment.type].insertAt(loadSegment, prevId);
	} else
		throw new Error("Currently, only one segment per type can be added");

	// undo/redo
	var profile = this;
	this.undoManager.add({
		undo: function() {
			profile.deleteLoadSegment(loadSegment.id, loadSegment.type);
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
	if (!newSegmentData.type)
		throw new Error("Expecting new segment to have type");

	//forcing new segment to be the same type as old segment
	var segment = this.profileLoads[newSegmentData.type].findById(segmentId);
	if (!segment)
		throw new Error("Unable to find segment with id " + segmentId + ".. is it of the same type as the old one?");

	this.profileLoads[newSegmentData.type].delete(segmentId);

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
		})
		return allLoadSegments;
	}

	if (!this.profileLoads[type])
		throw new Error("load type '" + type + "' doesn't appear to be a valid load segment type");

	return this.profileLoads[type].getAllSegments();
};


MotionProfile.prototype.generateBasicSegments = function () {
	segments = this.getAllBasicSegments();

	var basicSegments;

	segments.forEach(function (seg, i) {
		bsObj = {
			Number: 0, // what is Number?? -Brian
			InitalTIme: seg.initialTime,
			FinalTime: seg.finalTime,
			InitialPosition: seg.initialPosition,
			FinalPosition: seg.finalPosition,
			InitialVelocity: seg.initialVelocity,
			FinalVelocity: seg.finalVelocity,
			InitialAcceleration: seg.evaluateAccelerationAt(seg.initialTime),
			FinalAcceleration: seg.evaluateAccelerationAt(seg.finalTime),
			Jerk: seg.evaluateJerkAt((seg.finalTime+seg.initialTime)/2),
			InitialLoad: seg.load,
			FinalLoad: seg.load,
			InitialThrust: seg.thrust,
			FinalThrust: seg.thrust,
			InitialFriction: seg.friction,
			FinalFriction: seg.friction
		};

		basicSegments[i] = bsObj;
	});

	return basicSegments;
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

	return profile;
};


factory.AccelMotionSegment = AccelSegment.AccelMotionSegment;
factory.IndexMotionSegment = IndexSegment.IndexMotionSegment;

module.exports = factory;