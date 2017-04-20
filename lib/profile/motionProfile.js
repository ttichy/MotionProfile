/**
 * Creates MotionProfile. MotionProfile is a list of MotionSegments.
 * MotionSegments represent the various available segments in a profile, such as BasicSegment, AccelSegment,
 * CamSegment, IndexSegment, etc...
 *
 */
var AccelSegment = require('../segments/accelSegment');
var CruiseDwellSegment = require('../segments/CruiseDwellSegment');
var IndexSegment = require('../segments/indexSegment');
var LoadSegment = require('../segments/loadSegment');
var CamSegment= require('../segments/camSegment');
var MotionSegment = require('../segments/motionSegment');
var SegmentStash = require('../segments/segmentStash');
var fastMath = require('../util/fastMath');
var profileHelper = require('./profileHelper');
var undoManager = require('../util/undoManager');
var Util = require('../util/util');
var MotionPoint = require('./motionPoint').MotionPoint;
var _ = require('underscore');

//* Motion Profile *//
var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : 9007199254740991;


/**
 * Constructor for a motion profile object.
 * @param {string} type              'rotary' or 'linear'
 * @param {Object} initialConditions optional object with fields position, velocity, thrust, load,
 * and friction. If not provided, values set to 0 by default. If provided, all values must be present.
 */
var MotionProfile = function(type, initialConditions) {
	// rotary is treated as default
	this.type = type.toLowerCase() === "rotary" ? "rotary" : "linear";
	this.initialPosition = 0;
	this.initialVelocity = 0;
	this.initialThrust = 0;
	this.initialLoad = 0;
	this.initialFriction = 0;

	//create object to hold all the profile loads
	var loads = {};
	var initLoad = {};
	if (this.type === "rotary") {
		Object.keys(LoadSegment.RotaryLoadsEnum).forEach(function(load) {
			loads[load] = SegmentStash.makeStash();

			initLoad = LoadSegment.createLoadSegment(load, 0, MAX_SAFE_INTEGER, 0, 0);
			initLoad.segmentData.constant = true;
			loads[load].insertAt(initLoad, null);
		});
	} else {
		Object.keys(LoadSegment.LinearLoadsEnum).forEach(function(load) {
			loads[load] = SegmentStash.makeStash();
			initLoad = LoadSegment.createLoadSegment(load, 0, MAX_SAFE_INTEGER, 0, 0);
			initLoad.segmentData.constant = true;
			loads[load].insertAt(initLoad, null);
		});
	}

	this.clipboard = null;
	this.profileLoads = loads;
	this.undoManager = undoManager;

	MotionSegment.MotionSegment.call(this);

	if (!initialConditions) {
		this.setInitialConditions(0, 0, 0, 0, 0);
	} else {
		this.setInitialConditions(
			initialConditions.position,
			initialConditions.velocity,
			initialConditions.load,
			initialConditions.thrust,
			initialConditions.friction
		);
	}
};


MotionProfile.prototype = Object.create(MotionSegment.MotionSegment.prototype);
MotionProfile.prototype.constructor = MotionProfile;

/* Setters */

/**
 * Set the initial position and velocity for this motion profile
 * @param {Number} position position in [rad] or [m]
 * @param {Number} velocity velocity in [rad/s] or [m/s]
 */
MotionProfile.prototype.setInitialConditions = function(position, velocity, load, thrust, friction, skipUndo) {

	var p, v, l, t, f;
	p = this.initialPosition;
	v = this.initialVelocity;
	l = this.initialLoad;
	t = this.initialThrust;
	f = this.initialFriction;

	this.initialPosition = position;
	this.initialVelocity = velocity;

	this.initialThrust = thrust || this.initialThrust;
	this.initialLoad = load || this.initialLoad;
	this.initialFriction = friction || this.initialFriction;

	// check loads to see if they are a single constant segment
	var loadEnums = {};
	if (this.type == 'rotary') {
		loadEnums = LoadSegment.RotaryLoadsEnum;
	} else if (this.type == 'linear') {
		loadEnums = LoadSegment.LinearLoadsEnum;
	}

	var loadSeg;
	var profile = this;
	Object.keys(loadEnums).forEach(function(loadType, iter) {
		loadSeg = profile.profileLoads[loadType].firstSegment();
		if (profile.profileLoads[loadType].constant == true) {
			switch (iter+1) {
				case 1:
					loadSeg.modifySegmentValues({
						initialValue: profile.initialFriction,
						finalValue: profile.initialFriction
					});
				case 2:
					loadSeg.modifySegmentValues({
						initialValue: profile.initialLoad,
						finalValue: profile.initialLoad
					});
				case 3:
					loadSeg.modifySegmentValues({
						initialValue: profile.initialThrust,
						finalValue: profile.initialThrust
					});
			}
		} else {
			switch (iter+1) {
				case 1:
					loadSeg.modifySegmentValues({
						initialValue: profile.initialFriction
					});
				case 2:
					loadSeg.modifySegmentValues({
						initialValue: profile.initialLoad
					});
				case 3:
					loadSeg.modifySegmentValues({
						initialValue: profile.initialThrust
					});
			}
		}
	});


	// // after setting initial conditions, all subsequent modules must be recalculated
	var current = this.segments.firstSegment();

	try {
		this.recalculateProfileSegments(current);
	} catch (err) {
		this.setInitialConditions(p, v, l, t, f, true);
		throw new Error('Unable to modify initial conditions as it would invalidate a segment.');
	}

	if (!skipUndo) {
		var that = this;
		this.undoManager.add({
			undo: function () {
				that.setInitialConditions(p, v, l, t, f);
			},
			redo: function () {
				that.setInitialConditions(position, velocity, load, thrust, friction);
			}
		});
	}
};


/**
 * Sets inclination for linear profile
 * @param {number} inclination inclination in radians
 */
MotionProfile.prototype.setInclination = function(inclination) {
	if(!fastMath.isNumeric(inclination))
		throw new Error("inclination needs to be numeric");

	if(this.type !== 'linear')
		throw new Error("inclination can only be set for linear profiles");

	var oldInclination = this.inclination;
	this.inclination = inclination;

	var that = this;
	this.undoManager.add({
		undo: function () {
			that.inclination = oldInclination;
		},
		redo: function () {
			that.inclination = inclination;
		}
	});
};


/* Getters */

MotionProfile.prototype.findById = function(segmentId) {
	return this.segments.findById(segmentId);
};


/**
 * Gets all basic segments that exist in the profile. Basic Segments are the most basic building blocks
 * @return {Array} Array of BasicSegments
 */
MotionProfile.prototype.getAllBasicSegments = function() {
	var allSegments = [];
	if (this.segments.getAllSegments().length ===0) {
		return allSegments;
	}
	// using associative array to hold all segments -> quick and easy to search
	this.segments.getAllSegments().forEach(function(element) {
		allSegments.push(element.getAllSegments());
	});

	if(allSegments.length===0)
		return [];

	// previous code gets us an array of arrays, we need to flatten it
	return allSegments.reduce(function(a, b) {
		return a.concat(b);
	});
};


MotionProfile.prototype.getAllSegments = function() {
	return this.segments.getAllSegments();
};


/**
 * Returns all load segments present in the motion profile of the specified type
 * @param  {string} type Load type
 * @return {Array}      array of load segments of specified type
 */
MotionProfile.prototype.getAllLoadSegments = function(type) {

	// if there is not specific type, all load segments are returned
	if(!type) {
		var loadSegments;
		var allLoadSegments = [];
		var that = this;
		Object.keys(this.getValidLoadTypes()).forEach(function(type) {
			loadSegments = that.profileLoads[type].getAllSegments();
			allLoadSegments = allLoadSegments.concat(loadSegments);
		});
		return allLoadSegments;
	}

	if (!this.profileLoads[type]) {
		throw new Error("load type '" + type + "' doesn't appear to be a valid load segment type");
	}

	return this.profileLoads[type].getAllSegments();
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


/* Segment Modifiers */

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

	var prev, previousPoint;
	while (current) {
		prev = this.segments.getPreviousSegment(current.id);

		//handle first segment
		if (!prev) {
			previousPoint = new MotionPoint(0, 0, 0, this.initialVelocity, this.initialPosition);
		} else {
			previousPoint = prev.getFinalValues();
		}

		current.modifyInitialValues(previousPoint);

		//move next
		current = this.segments.getNextSegment(current.id);
	}
};


/**
 * Used to change the values of a segment. This is NOT for changing the segment type (i.e. Accel to Index).
 * It is only for changing the values within a segment. This includes different data permutations for Accel.
 * @param	{int}			unique segment id used to find segment to edit
 * @param	{Object}		newSegmentData new segment data specific to the segment type
 * @returns	{MotionSegment}	modified segment. This segment can be significantly different than the segment found using
 * segmentId.
 */
MotionProfile.prototype.modifySegmentValues = function(segmentId, newSegmentData, skipUndo) {
	// get the segment using segmentId
	var segment = this.findById(segmentId);
	if (!segment)
		throw new Error("Unable to find segment with id " + segmentId);

	// get the initial conditions
	var initialConditions;
	var prevSeg = this.segments.getPreviousSegment(segmentId);
	if (prevSeg) {
		initialConditions = {
			time: prevSeg.finalTime,
			position: prevSeg.evaluatePositionAt(prevSeg.finalTime),
			velocity: prevSeg.evaluateVelocityAt(prevSeg.finalTime),
		};
	} else {
		initialConditions = {
			time: 0,
			position: this.initialPosition,
			velocity: this.initialVelocity
		};
	}

	var originalSegmentData = {};
	Util.extend(originalSegmentData, segment.segmentData);
	 // function(t, j, a, v, p,l,th,f) {
	var originalInitialConditions = {
		time: segment.initialTime,
		// segment.evaluateJerkAt(segment.initialTime),
		// segment.evaluateAccelerationAt(segment.initialTime),
		velocity: segment.evaluateVelocityAt(segment.initialTime),
		position: segment.evaluatePositionAt(segment.initialTime)
		// segment.evaluateLoadAt(segment.initialTime),
		// segment.evaluateThrustAt(segment.initialTime),
		// segment.evaluateFrictionAt(segment.initialTime)
	};

	try {
		var modified = segment.modifySegmentValues(newSegmentData, initialConditions);

		if (modified.id !== segment.id) {
			modified.id = segment.id;
			this.replaceSegment(segment.id, modified);
		}

		//after modifying a segment all subsequent segments must be recalculated
		var next = this.segments.getNextSegment(segmentId);
		this.recalculateProfileSegments(next);
	} catch (err) {
		this.modifySegmentValues(segmentId, originalSegmentData, initialConditions, true);
		throw new Error("Modifying segment failed with " + err);
	}

	//undo / redo
	if (!skipUndo) {
		var profile = this;
		this.undoManager.add({
			undo: function() {
				profile.modifySegmentValues(segmentId, originalSegmentData, initialConditions);
			},
			redo: function() {
				profile.modifySegmentValues(segmentId, newSegmentData, initialConditions);
			}
		});
	}

	return modified;
};


MotionProfile.prototype.invertSegment = function (segmentId) {
	var seg = this.findById(segmentId);
	if (typeof seg.invert == 'function') {
		seg.invert();

		var that = this;
		this.undoManager.add({
			undo: function () {
				seg.invert();
			},
			redo: function () {
				seg.invert();
			}
		});

		var next = this.segments.getNextSegment(segmentId);
		this.recalculateProfileSegments(next);
	} else {
		throw new Error('You cannot invert this segment.');
	}
}


/**
 * Inserts or appends a segment into the motion profile
 * @param {MotionSegment} segment Segment to insert into the profile
 * @param {Number} segmentId id of the segment BEFORE which to insert
 */
MotionProfile.prototype.insertSegment = function(segment, segmentId, skipUndo) {
	if (!(segment instanceof MotionSegment.MotionSegment))
		throw new Error('Attempting to insert an object which is not a MotionSegment');

	//need to get final values of previous segment
	var prev = this.segments.getPreviousSegment(segmentId);
	var originalLastValues = {
		time: segment.initialTime,
		velocity: segment.evaluateVelocityAt(segment.initialTime),
		position: segment.evaluatePositionAt(segment.initialTime)
	};

	var lastValues;
	if (prev !== null) {
		//modify the segment being inserted to make sure initial values == previous segment's final values
		lastValues = prev.getFinalValues();
	} else {
		lastValues = new MotionPoint(0, 0, 0, this.initialVelocity, this.initialPosition);
		// return this.appendSegment(segment);
	}

	try {
		segment.modifyInitialValues(lastValues);
	} catch (err) {
		segment.modifyInitialValues(originalLastValues, true);
		throw new Error('Inserting segment failed with ' + err);
	}

	var newSegment = this.segments.insertAt(segment, segmentId);
	if (!newSegment) {
		segment.modifyInitialValues(originalLastValues);
		throw new Error("inserting a segment failed");
	}

	try {
		//after inserting a segment, all subsequent segments must be recalculated
		var current = this.segments.getNextSegment(newSegment.id);
		this.recalculateProfileSegments(current);
	} catch (err) {
		this.segments.delete(segment.id);
		this.recalculateProfileSegments(current);
		throw new Error('Inserting segment failed with ' + err);
	}

	// undo /redo functionality
	if (!skipUndo) {
		var profile = this;
		this.undoManager.add({
			undo: function() {
				profile.deleteSegment(newSegment.id);
			},
			redo: function() {
				profile.insertSegment(segment, segmentId);
			}
		});
	}

	return segment;
};


/**
 * Append segment at the end of the current profile
 * @param  {[type]} segment [description]
 * @return {[type]}         [description]
 */
MotionProfile.prototype.appendSegment = function(segment, skipUndo) {
	if (!(segment instanceof MotionSegment.MotionSegment))
		throw new Error('Attempting to insert an object which is not a MotionSegment');

	// even though we append at the end, still have to make sure that initial/final conditions are satisfied
	var lastSegment = this.segments.lastSegment();
	var lastPoint;

	if (!lastSegment) {
		lastPoint = new MotionPoint(0, 0,0, this.initialVelocity, this.initialPosition);
	} else {
		lastPoint = lastSegment.getFinalValues();
	}

	segment.modifyInitialValues(lastPoint);


	this.segments.insertAt(segment, null);

	// undo/redo functionality
	if (!skipUndo) {
		var profile = this;
		this.undoManager.add({
			undo: function() {
				profile.deleteSegment(segment.id);
			},
			redo: function() {
				profile.appendSegment(segment);
			}
		});
	}

	return segment;
};


/**
 * Deletes specified segment. Suppose we have segments 1, 2 and 3 and want to delete 2.
 * 	First, we delete segment 2. Then, we modify the initial values of segment 3 to be the final values of segment 1
 * @param {MotionSegment} segmentId identify segment to delete
 */
MotionProfile.prototype.deleteSegment = function(segmentId, skipUndo) {
	if (!fastMath.isNumeric(segmentId) || fastMath.lt(segmentId, 0))
		throw new Error('expect segmentId to be a positive integer');

	var current = this.segments.getNextSegment(segmentId);

	var segToDelete = this.segments.delete(segmentId);

	if (!segToDelete)
		throw new Error("Unable to delete segment with id " + segmentId);

	try {
		this.recalculateProfileSegments(current);
	} catch (err) {
		if (!current) {
			this.appendSegment(segToDelete, true);
		} else {
			this.insertSegment(segToDelete, current.id, true);
		}
		throw new Error('Attempt to delete segment failed downstream with error: ' + err);
	}

	//undo / redo
	if (!skipUndo) {
		var profile = this;
		this.undoManager.add({
			undo: function() {
				//special case for handling last segment
				if(!current)
					profile.appendSegment(segToDelete);
				else
					profile.insertSegment(segToDelete, current.id);
			},
			redo: function() {
				profile.deleteSegment(segmentId);
			}
		});
	}

	return segToDelete;
};


MotionProfile.prototype.replaceSegment = function (oldId, newSegment) {
	var oldSeg = this.segments.replace(oldId, newSegment);
	try {
		this.recalculateProfileSegments(newSegment);
	} catch (err) {
		this.segments.replace(oldId, oldSeg);
		this.recalculateProfileSegments(oldSeg);
		throw new Error('Replacing segment failed with ' + err);
	}
};


/* Profile Modifiers */

/** Delets the cut segment from profile and stores it for paste operation
 * @param  {segment id}
 */
MotionProfile.prototype.cutSegment = function (segmentId) {
	var next = this.segments.getNextSegment(segmentId);
	var oldClipboard = this.clipboard;

	var cutSegment = this.segments.delete(segmentId);

	if (!cutSegment) {
		throw new Error('Failed to cut segment with id ' + segmentId);
	}

	try {
		this.recalculateProfileSegments(next);
	} catch (err) {
		if (!next) {
			this.appendSegment(cutSegment, true);
		} else {
			this.insertSegment(cutSegment, next.id, true);
		}
		throw new Error('Attempt to cut segment failed downstream with error: ' + err);
	}

	this.clipboard = cutSegment;

	// undo/redo support
	var profile = this;
	this.undoManager.add({
		undo: function() {
			if (!next) {
				profile.appendSegment(cutSegment);
			} else {
				profile.insertSegment(cutSegment, next.id);
			}
			profile.clipboard = oldClipboard;
		},
		redo: function() {
			profile.cutSegment(segmentId);
		}
	});
};


/** sets up a segment to be copied
 * @param  {segment id}	segment id to copy
 */
MotionProfile.prototype.copySegment = function (segmentId) {
	var segment = this.findById(segmentId);

	if (segment.type == 'cam' && segment.segmentData.master.length > 1000) {
		throw new Error('You are not allowed to copy/paste cam segments with more than 1000 points');
	} else {
		var oldClipboard = this.clipboard;
		this.clipboard = segment.duplicate();

		var profile = this;

		// I don't think this needs undoManager support.... - Brian
		this.undoManager.add({
			undo: function() {
				profile.clipboard = oldClipboard;
			},
			redo: function() {
				profile.copySegment(segmentId);
			}
		});
	}
};


/** pastes the cut or copied segment before the segment id provided
 * @param  {segment id}	segment id to insert the cut or copied segment in front of
 */
MotionProfile.prototype.pasteSegment = function (segmentId) {
	if (this.clipboard !== null) {
		if (!(this.clipboard instanceof MotionSegment.MotionSegment))
			throw new Error('Attempting to paste an object which is not a MotionSegment');

		//need to get final values of previous segment
		var prev = this.segments.getPreviousSegment(segmentId);
		var originalLastValues = {
			time: this.clipboard.initialTime,
			velocity: this.clipboard.evaluateVelocityAt(this.clipboard.initialTime),
			position: this.clipboard.evaluatePositionAt(this.clipboard.initialTime)
		};

		var lastValues;
		if (prev !== null) {
			//modify the segment being inserted to make sure initial values == previous segment's final values
			lastValues = prev.getFinalValues();
		} else {
			lastValues = new MotionPoint(0, 0, 0, this.initialVelocity, this.initialPosition);
			// return this.appendSegment(segment);
		}

		try {
			this.clipboard.modifyInitialValues(lastValues);
		} catch (err) {
			this.clipboard.modifyInitialValues(originalLastValues, true);
			throw new Error('Pasting segment failed with ' + err);
		}

		var pastedSegment = this.segments.insertAt(this.clipboard, segmentId);
		if (!pastedSegment) {
			this.clipboard.modifyInitialValues(originalLastValues);
			throw new Error('Pasting segment failed');
		}

		try {
			//after inserting a segment, all subsequent segments must be recalculated
			var current = this.segments.getNextSegment(pastedSegment.id);
			this.recalculateProfileSegments(current);
		} catch (err) {
			this.segments.delete(pastedSegment.id);
			this.recalculateProfileSegments(current);
			throw new Error('Pasting segment failed with ' + err);
		}

		// try {
		// 	var pSeg = this.insertSegment(this.clipboard, segmentId, true);
		// } catch (err) {
		// 	this.deleteSegment(this.clipboard.id, true);
		// 	throw new Error('Pasting Segment failed with ' + err);
		// }

		var pDup = pastedSegment.duplicate(); // just in case we want to paste again
		this.clipboard = pDup;
		var profile = this;

		this.undoManager.add({
			undo: function() {
				profile.clipboard = profile.deleteSegment(pastedSegment.id);
			},
			redo: function() {
				profile.pasteSegment(segmentId);
			}
		});
	} else {
		throw new Error('You must cut or copy a segment first in order to paste!');
		// return;
	}
};


/**
 * Removes all profile segments
 */
MotionProfile.prototype.clear = function() {

	//need to save all segments
	var oldSegments = this.segments;

	this.segments = SegmentStash.makeStash();

	var that = this;
	this.undoManager.add({
		undo: function () {
			that.segments = oldSegments;
		},
		redo: function () {
			that.clear();
		}
	});
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



/* Loads */

/**
 * Adds a load segment to the profile
 * @param {LoadSegment} loadSegment load segment to be added
 */
MotionProfile.prototype.addLoadSegment = function(loadSegment, skipUndo) {
	if (!LoadSegment.LoadSegment.prototype.isValidType(this.type, loadSegment.segmentData.loadType))
		throw new Error("Load type '" + loadSegment.segmentData.loadType + "' is not valid for " + this.type + " profiles");

	var lType = loadSegment.segmentData.loadType;
	var allLoadSegs = this.profileLoads[loadSegment.segmentData.loadType].getAllSegments();
	var replace = false;

	// insert or append
	if (allLoadSegs.length == 1 && allLoadSegs[0].segmentData.finalTime == MAX_SAFE_INTEGER) {
		// if we have a constant segment, replace it
		replace = true;

	} else if (this.profileLoads[loadSegment.segmentData.loadType].findOverlappingSegment(loadSegment.initialTime, loadSegment.finalTime)) {
		throw new Error("New segment overlaps an existing segment");
	}

	if (replace) {
		// this.profileLoads[lType].replace(allLoadSegs[0].id, loadSegment);
		this.profileLoads[lType].delete(allLoadSegs[0].id);
		this.profileLoads[lType].insertAt(loadSegment, null);
	} else {
		// find previous segment. Needed in case of insertion
		var prevSegment = this.profileLoads[loadSegment.segmentData.loadType].getPreviousByInitialTime(loadSegment.t0);
		var prevId = null;
		if (prevSegment)
			prevId = prevSegment.id;

		this.profileLoads[loadSegment.segmentData.loadType].insertAt(loadSegment, prevId);
	}

	// undo/redo
	if (!skipUndo) {
		var profile = this;
		this.undoManager.add({
			undo: function() {
				if (replace) {
					profile.deleteLoadSegment(loadSegment.id, loadSegment.segmentData.loadType, true);
					profile.addLoadSegment(allLoadSegs[0], true);
				} else {
					profile.deleteLoadSegment(loadSegment.id, loadSegment.segmentData.loadType, true);
				}
			},
			redo: function() {
				profile.addLoadSegment(loadSegment, true);
			}
		});
	}
};


/**
 * Deletes load segment identified by segmentId, optionally uses type to identify load type
 * @param  {Number} segmentId identfies segment
 * @param  {string} type      load type
 * @return {LoadSegment}      deleted load segment
 */
MotionProfile.prototype.deleteLoadSegment = function(segmentId, type, skipUndo) {
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
	if (!skipUndo) {
		var profile = this;
		this.undoManager.add({
			undo: function() {
				profile.addLoadSegment(deletedSegment);
			},
			redo: function() {
				profile.deleteLoadSegment(segmentId, type);
			}
		});
	}

	return deletedSegment;
};


MotionProfile.prototype.modifyLoadSegment = function(segmentId, newSegmentData, skipUndo) {
	if (!newSegmentData.segmentData.loadType)
		throw new Error("Expecting new segment to have type");

	//forcing new segment to be the same type as old segment
	var segment = this.profileLoads[newSegmentData.segmentData.loadType].findById(segmentId);
	if (!segment)
		throw new Error("Unable to find segment with id " + segmentId + ".. is it of the same type as the old one?");

	this.profileLoads[newSegmentData.segmentData.loadType].delete(segmentId);

	this.addLoadSegment(newSegmentData);

	//undo / redo
	if (!skipUndo) {
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
	}
};


/* Export/Import */

MotionProfile.prototype.generateBasicSegments = function () {

	//how to handle empty profiles? Does it handle it already?

	// this sets up the enums. Probably a better way to do this, but it works for now
	var fri, loa, thr;
	if (this.type == "rotary") {
		fri = "FRICTION";
		loa = "INERTIA";
		thr = "EXTERNAL_TORQUE";
	} else {
		fri = "FRICTION_COEFF";
		loa = "MASS";
		thr = "FORCE";
	}

	if (this.segments.lastSegment() === null) {
		return [];
	}


	// get all initial times and final times from load segments and motion profiles, remove duplicates, and sort
	var segTimesI = _.map(this.getAllBasicSegments(), _.property('initialTime'));
	var loadTimesI = _.map(this.getAllLoadSegments(), _.property('initialTime'));
	var segTimesF = _.map(this.getAllBasicSegments(), _.property('finalTime'));
	var loadTimesF = _.map(this.getAllLoadSegments(), _.property('finalTime'));
	// uniq removes duplicates. the sort method sorts numbers (not strings, which is javascript's default) ascending.
	var times = _.uniq([].concat(segTimesI, loadTimesI, segTimesF, loadTimesF)).sort(function (current, next) {
		return current-next;
	});

	times = _.without(times, MAX_SAFE_INTEGER);

	// set up variables
	var f_i, f_f, l_i, l_f, t_i, t_f; // load variables
	var that = this; // reference profile object inside forEach loop
	var basicSegments = [];
	var bsObj = {};

	times.forEach(function (time, i) {
		if (i < (times.length-1)) {
			f_i = that.profileLoads[fri].findSegmentWithTime(times[i]) === null ? 0 : that.profileLoads[fri].findSegmentWithTime(times[i]).loadPoly.evaluateAt(times[i]);
			f_f = that.profileLoads[fri].findSegmentWithTime(times[i+1]) === null ? 0 : that.profileLoads[fri].findSegmentWithTime(times[i+1]).loadPoly.evaluateAt(times[i+1]);

			l_i = that.profileLoads[loa].findSegmentWithTime(times[i]) === null ? 0 : that.profileLoads[loa].findSegmentWithTime(times[i]).loadPoly.evaluateAt(times[i]);
			l_f = that.profileLoads[loa].findSegmentWithTime(times[i+1]) === null ? 0 : that.profileLoads[loa].findSegmentWithTime(times[i+1]).loadPoly.evaluateAt(times[i+1]);

			t_i = that.profileLoads[thr].findSegmentWithTime(times[i]) === null ? 0 : that.profileLoads[thr].findSegmentWithTime(times[i]).loadPoly.evaluateAt(times[i]);
			t_f = that.profileLoads[thr].findSegmentWithTime(times[i+1]) === null ? 0 : that.profileLoads[thr].findSegmentWithTime(times[i+1]).loadPoly.evaluateAt(times[i+1]);

			bsObj = {
				// Number: 0, // what is Number?? -Brian
				InitialTime: times[i],
				FinalTime: times[i+1],
				InitialPosition: that.evaluatePositionAt(times[i]),
				FinalPosition: that.evaluatePositionAt(times[i+1]),
				InitialVelocity: that.evaluateVelocityAt(times[i]),
				FinalVelocity: that.evaluateVelocityAt(times[i+1]),
				InitialAcceleration: that.evaluateAccelerationAt(times[i]),
				FinalAcceleration: that.evaluateAccelerationAt(times[i+1]),
				Jerk: that.evaluateJerkAt( (times[i]+times[i+1])/2 ), // pull the jerk value from a centered timepoint.
				InitialLoad: l_i + that.evaluateLoadAt(times[i]),
				FinalLoad: l_f + that.evaluateLoadAt(times[i+1]),
				InitialThrust: t_i + that.evaluateThrustAt(times[i]),
				FinalThrust: t_f + that.evaluateThrustAt(times[i+1]),
				InitialFriction: f_i + that.evaluateFrictionAt(times[i]),
				FinalFriction: f_f + that.evaluateFrictionAt(times[i+1])
			};
			basicSegments[i] = bsObj;
		}
	});

	return basicSegments;
};


//* Factory *//

var factory = {};


/* Creation */

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

/**
 * creates an index segment
 * @param  {[type]} segment object containing inputs fields for the new index segment. These values are:
 * t0: initial time
 * tf: final time
 * p0: initial position
 * pf: final position
 * v: velocity
 * velLimPos: positive velocity limit (default null | number)
 * velLimNeg: negative velocity limit (default null | number)
 * accJerk: acceleration jerk (default 0.4 | <0,1>)
 * decJerk: deceleration jerk(default 0.4 | <0,1>)
 * xSkew: hidden value (default 0)
 * ySkew: hidden value (default 0.5)
 * shape: shape ('triangle' or 'trapezoid')
 * mode: mode ('incremental' or 'absolute')
 * loads: optional loads friction, thrust, load as object
 * @return {[type]}         an index segment
 */
factory.createIndexSegment = function(segment) {
	if (!segment)
		throw new Error("Need segment data to create a segment");

	// (t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode)
	return IndexSegment.Make(segment.t0, segment.tf, segment.p0, segment.pf, segment.v, segment.velLimPos, segment.velLimNeg, segment.accJerk, segment.decJerk, segment.xSkew, segment.ySkew, segment.shape, segment.mode, segment.loads);
};


factory.createCruiseDwellSegment = function(segment) {
	if (!segment)
		throw new Error("Need segment data to create a segment");

	// function(t0, tf, p0, v0, pf, permutation, mode, loads){
	return CruiseDwellSegment.Make(segment.t0, segment.tf, segment.p0, segment.v0, segment.pf, segment.permutation, segment.mode, segment.loads);
};


factory.createCamSegment = function(prevTime,prevPosition,prevVelocity,loads) {
	return CamSegment.Make(prevTime,prevPosition,prevVelocity,loads);
};


factory.createLoadSegment = function(loadType, t0, tf, initVal, finalVal){
	return LoadSegment.createLoadSegment(loadType, t0, tf, initVal, finalVal);
};


/* Export/Import */

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
	profileObj.inclination = profile.inclination || 0;

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

	profile.initialVelocity=profileObj.initialVelocity || 0;
	profile.initialPosition=profileObj.initialPosition || 0;
	profile.initialLoad=profileObj.initialLoad || 0;
	profile.initialThrust = profileObj.initialThrust || 0;
	profile.initialFriction = profileObj.initialFriction || 0;


	if(profileObj.type==='linear')
		profile.setInclination(profileObj.inclination);


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

/**
 * Converts the profile to a specific type (linear or rotary)
 * @param  {[type]} profile the motion profile object you want to switch
 * @param  {[type]} newType the type you want to switch it to. Must be 'linear' or 'rotary'.
 * @return {[type]}         returns a new blank profile of the newType if and only if the user
 * correctly specifies a profile switch.
 */
factory.switchProfileType = function (profile, newType) {
	if (!(['linear', 'rotary'].includes(newType.toLowerCase()))) {
		throw new Error('Profile type must be either linear or rotary');
	}

	if (profile.type == newType) {
		throw new Error('The profile is already of type ' + profile.type);
	} else {
		return factory.createMotionProfile(newType);
	}
};


factory.convertV1ToV2 = function(motionProfile) {
	var pj = JSON.parse(motionProfile.ProfileJson);

	var profile = (motionProfile.LibraryItemType === "Rotary Profile") ? this.createMotionProfile('rotary') : this.createMotionProfile('linear');
	// var that = this;

	pj.motion.points.forEach(function (point, i) {
		if (i == 1) {
			// first point is the initial conditions
			profile.setInitialConditions(point.position, point.velocity, 0, 0, 0);
		} else {
			var lvs = profile.getFinalValues();
			// index segment
			if (point.segmentParameters && point.segmentParameters.segmentType === "IndexSegment") {
				// var lvs = profile.getFinalValues();

				if (fastMath.equal(lvs[2], point.velocity)) {
					// if the velocity does not change, make a normal index segment. if the velocities don't match, change it to an accel/coast/accel
					var vlp = fastMath.equal(point.segmentParameters.absoluteVelocityLimit, 0) ? null : point.segmentParameters.absoluteVelocityLimit;
					var vln = fastMath.equal(point.segmentParameters.absoluteVelocityLimit, 0) ? null : -point.segmentParameters.absoluteVelocityLimit;

					profile.appendSegment(
						this.createIndexSegment({
			                //(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {
			                t0: lvs[0],
			                tf: point.time/1000,
			                p0: lvs[3],
			                pf: point.position,
			                v: lvs[2],
			                velLimPos: vlp,
			                velLimNeg: vln,
							accJerk: point.segmentParameters.jerkAccelerationPercent/100,
			                decJerk: point.segmentParameters.jerkDecelerationPercent/100,
			                xSkew: null,
			                ySkew: null,
			                shape: point.segmentParameters.type.toLowerCase(),
			                mode: 'incremental'
			            })
					);
				} else {
					// finish this acc/coast/acc stuff
					// var acc1 = this.createAccelSegment('time-velocity');
					// var coast = this.createCruiseDwellSegment();
					// var acc2 = this.createAccelSegment('time-velocity');

					// profile.appendSegment(acc1);
					// profile.appendSegment(coast);
					// profile.appendSegment(acc2);
				}
			} else if (point.segmentParameters && point.segmentParameters.segmentType === "CamSegment") {
				// this is supposed to check if the point.segmentParameters thing exists before checking the segmentType. May not work. Needs testing

			} else {
				// check for constant velocity for cruiseDwell
				if (fastMath.equal(point.velocity, pj.motion.points[i].velocity)) {
					// t0,tf,p0,v0,pf, permutation, mode, loads
					profile.appendSegment(this.createCruiseDwellSegment({
						t0: lvs[0],
						tf: point.time/1000,
						p0: lvs[3],
						v0: lvs[2],
						pf: point.position,
						permutation: 'time',
						mode: 'incremental'
					}));
				} else {
					// time-velocity accel segment
					profile.appendSegment(
						this.createAccelSegment({

						})
					);
				}
			}
		}
	}, this);

	pf.loads.forEach(function (load, i) {

	}, this);

	return profile;
};


factory.AccelMotionSegment = AccelSegment.AccelMotionSegment;
factory.IndexMotionSegment = IndexSegment.IndexMotionSegment;
factory.CamMotionSegment = CamSegment.CamMotionSegment;
factory.CruiseDwellMotionSegment = CruiseDwellSegment.CruiseDwellMotionSegment;
factory.MotionPoint = MotionPoint.MotionPoint;


module.exports = factory;