describe('Unit: motionProfileFactory testing', function() {
    var motionProfileFactory = require('../lib/profile/motionProfile');
    var accelSegmentFactory = require('../lib/segments/accelSegment');
    var indexSegmentFactory = require('../lib/segments/indexSegment');
    var fastMath = require('../lib/util/fastMath');
    var ph = require('../lib/profile/profileHelper');

    it('should create an empty rotary profile', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        expect(profile.type).toBe('rotary');
        expect(profile.getAllBasicSegments.length).toBe(0);
    });

    it('should create an empty linear profile', function() {

        var profile = motionProfileFactory.createMotionProfile("linear");

        expect(profile.type).toBe('linear');
        expect(profile.getAllBasicSegments.length).toBe(0);
    });

    it('should correctly delete an accel segment that is the last segment', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment);

        accelSegment = accelSegmentFactory.MakeFromTimeVelocity(2, 3, 0, 0, 7.5, 0.5);

        profile.appendSegment(accelSegment);

        profile.deleteSegment(accelSegment.id);

        var segments = profile.getAllSegments();

        expect(segments.length).toBe(1);

        var seg0 = segments[0];
        expect(seg0.initialTime).toBe(0);
        expect(seg0.finalTime).toBe(2);
        expect(seg0.evaluatePositionAt(0.5)).toBeCloseTo(0.277777, 4);

        //also, the profile needs to be valid
        expect(ph.validateBasicSegments(profile.getAllBasicSegments())).toBe(true);
    });

    it('Should correctly return segments length when deleting and appending segments', function () {
        var profile = motionProfileFactory.createMotionProfile('linear');

        var accelSegment = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 0.7,
                p0: 0,
                v0: 0,
                vf: 1.5,
                jPct: 0.2,
                mode: 'absolute'
        }));

        var indexSeg = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: accelSegment.finalTime,
                tf: accelSegment.finalTime + 0.8,
                p0: accelSegment.evaluatePositionAt(accelSegment.finalTime),
                pf: accelSegment.evaluatePositionAt(accelSegment.finalTime) - 1.45,
                v: accelSegment.evaluateVelocityAt(accelSegment.finalTime),
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.1,
                decJerk: 0,
                xSkew: 0,
                ySkew: 0.5,
                shape: 'trapezoid',
                mode: 'incremental'
        }));

        // expect basic segments to be 2
        expect(profile.getAllBasicSegments().length).toBe(8);

        // delete the index segment
        profile.deleteSegment(indexSeg.id);

        // segments should be length 1
        expect(profile.getAllBasicSegments().length).toBe(3);

        profile.undo();

        // undoing the delete should return basic segments length to 8
        expect(profile.getAllBasicSegments().length).toBe(8);
    });

    it('should correctly delete an accel segment that is NOT the last segment', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment);

        var accelSegmentDelete = accelSegmentFactory.MakeFromTimeVelocity(2, 3, 0, 0, 7.5, 0.5);

        profile.appendSegment(accelSegmentDelete);

        accelSegment = accelSegmentFactory.MakeFromTimeVelocity(3, 5, 0, 0, 3, 0.5);

        profile.appendSegment(accelSegment);

        accelSegment = accelSegmentFactory.MakeFromTimeVelocity(5, 8, 0, 0, 0, 0.5);

        profile.appendSegment(accelSegment);

        profile.deleteSegment(accelSegmentDelete.id);

        var segments = profile.getAllSegments();

        expect(segments.length).toBe(3);

        var seg0 = segments[0];
        expect(seg0.initialTime).toBe(0);
        expect(seg0.finalTime).toBe(2);
        expect(seg0.evaluatePositionAt(0.5)).toBeCloseTo(0.277777, 4);

        //also, the profile needs to be valid
        expect(ph.validateBasicSegments(profile.getAllBasicSegments())).toBe(true);
    });

    it('should correctly delete an accel segment the first segment', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegmentDelete = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegmentDelete);

        var accelSegment = accelSegmentFactory.MakeFromTimeVelocity(2, 3, 0, 0, 7.5, 0.5);

        profile.appendSegment(accelSegment);

        accelSegment = accelSegmentFactory.MakeFromTimeVelocity(3, 5, 0, 0, 3, 0.5);

        profile.appendSegment(accelSegment);

        accelSegment = accelSegmentFactory.MakeFromTimeVelocity(5, 8, 0, 0, 0, 0.5);

        profile.appendSegment(accelSegment);

        profile.deleteSegment(accelSegmentDelete.id);

        var segments = profile.getAllSegments();

        expect(segments.length).toBe(3);

        var seg0 = segments[0];
        expect(seg0.initialTime).toBe(0);
        expect(seg0.finalTime).toBe(1);
        expect(seg0.evaluatePositionAt(0.5)).toBeCloseTo(0.72916, 4);

        //also, the profile needs to be valid
        expect(ph.validateBasicSegments(profile.getAllBasicSegments())).toBe(true);
    });

    it('should correctly find existing segments with exact matches', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        profile.appendSegment(accelSegment2);

        var existing = profile.getExistingSegment(0);
        expect(existing.initialTime).toBe(0);

        existing = profile.getExistingSegment(2);
        expect(existing.initialTime).toBe(2);
    });

    it('should not find any segments before and after the existing profile segment range', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        profile.appendSegment(accelSegment2);

        var existing = profile.getExistingSegment(1);
        expect(existing).toBe(null);

        existing = profile.getExistingSegment(3);
        expect(existing).toBe(null);
    });

    it('should find existing segments, even if initialTime is off by some number less than epsilon', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        profile.appendSegment(accelSegment2);

        var existing = profile.getExistingSegment(0 - fastMath.epsilon / 2);
        expect(existing).not.toBe(null);
        expect(existing.initialTime).toBe(accelSegment1.initialTime);

        existing = profile.getExistingSegment(2 + fastMath.epsilon / 2);
        expect(existing).toBe(accelSegment2);
    });

    it('should insert a segment in between two other segments', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        profile.appendSegment(accelSegment2);

        var accelSegment3 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 5, 0, 0.5);

        profile.insertSegment(accelSegment3, accelSegment2.id);

        //after inserting, there should be 3 segments total
        expect(profile.getAllSegments().length).toBe(3);

        var allBasicSegments = profile.getAllBasicSegments();

        //also, the profile needs to be valid
        expect(ph.validateBasicSegments(profile.getAllBasicSegments())).toBe(true);
    });

    it('should insert a segment before an existing first segment', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(0, 1, 10, 10, 0, 0.5);

        profile.insertSegment(accelSegment2, accelSegment1.id);

        //after inserting, there should be 3 segments total
        expect(profile.getAllSegments().length).toBe(2);

        var allBasicSegments = profile.getAllBasicSegments();

        //also, the profile needs to be valid
        expect(ph.validateBasicSegments(profile.getAllBasicSegments())).toBe(true);
    });

    it("should be able to find parent segment via its child segment id", function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var allSegments = profile.getAllBasicSegments();

        var childSegment = allSegments[1];

        var parent = profile.findParentSegmentByChildId(childSegment.id);

        expect(parent).toBe(seg1);
    });

    it('appending a segment should match final conditions of the previous segment ', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 5, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 3, 0.5);

        profile.appendSegment(accelSegment2);

        var allBasicSegments = profile.getAllBasicSegments();

        //also, the profile needs to be valid
        expect(ph.validateBasicSegments(profile.getAllBasicSegments())).toBe(true);
    });

    it("should be able to find parent segment via its child segment id", function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var allSegments = profile.getAllBasicSegments();

        var childSegment = allSegments[1];

        var parent = profile.findParentSegmentByChildId(childSegment.id);

        expect(parent).toBe(seg1);
    });


    it('it should append incremental segment after absolute segment and correctly evalute final values ', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");
        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 5, 0.5, "absolute");

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(4, 6, 10, 10, 3, 0.5, "incremental");

        profile.appendSegment(accelSegment2);

        var allBasicSegments = profile.getAllSegments();

        //also, the profile needs to be valid
        expect(allBasicSegments[1].finalTime).toBe(4);
    });

    it("should be able to create segments via motionProfile accel segment function", function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");
        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var allSegments = profile.getAllBasicSegments();
        expect(allSegments.length).toBe(3);
    });

    it("should be able to modify final position for AccelSegmentTimeDistance segment ", function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-distance", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            pf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        sameSeg.modifySegmentValues({
            distance: 2.5
        }, {
            position: 0,
            velocity: 0
        });

        var finalValues = sameSeg.getFinalValues();

        expect(finalValues.position).toBe(2.5);
        expect(finalValues.velocity).toBe(2.5);
    });

    it("should be able to modify final time for AccelSegmentTimeDistance segment ", function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-distance", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            pf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        sameSeg.modifySegmentValues({
            duration: 1
        }, {
            position: 0,
            velocity: 0
        });

        var finalValues = sameSeg.getFinalValues();

        expect(finalValues.position).toBe(5);
        expect(finalValues.velocity).toBe(10);
    });

    it("should be able to modify final time, final position and jerk for AccelSegmentTimeDistance segment ", function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-distance", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            pf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        sameSeg.modifySegmentValues({
            duration: 1,
            distance: 1.5,
            jerkPercent: 0.25
        }, {
            position: 0,
            velocity: 0
        });

        var finalValues = sameSeg.getFinalValues();

        expect(finalValues.position).toBe(1.5);
        expect(finalValues.velocity).toBe(3);
    });

    it("should be able to modify final velocity for AccelSegmentTimeVelocity segment ", function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        sameSeg.modifySegmentValues({
            finalVelocity: 2.5
        }, {
            position: 0,
            velocity: 0
        });

        var finalValues = sameSeg.getFinalValues();

        expect(finalValues.position).toBe(2.5);
        expect(finalValues.velocity).toBe(2.5);
    });

    it("should be able to modify final velocity for AccelSegmentTimeVelocity segment using motionProfile function", function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        profile.modifySegmentValues(seg1.id, {
            finalVelocity: 2.5
        }, {
            position: 0,
            velocity: 0
        });

        var finalValues = sameSeg.getFinalValues();


        expect(finalValues.position).toBe(2.5);
        expect(finalValues.velocity).toBe(2.5);
    });

    it("should be able to modify final velocity, duration and jerk for AccelSegmentTimeVelocity segment ", function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        sameSeg.modifySegmentValues({
            finalVelocity: 2.5,
            duration: 1.2,
            jerkPercent: 0.25
        }, {
            position: 0,
            velocity: 0
        });

        var finalValues = sameSeg.getFinalValues();

        expect(finalValues.position).toBeCloseTo(1.5, 0.8);
        expect(finalValues.velocity).toBe(2.5);
    });

    it('should be able to undo appending a segment ', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 5, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 3, 0.5);

        profile.appendSegment(accelSegment2);

        var allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(2);

        //perform the undo operation
        profile.undo();

        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(1);
        expect(allSegments[0]).toBe(accelSegment1);

        profile.undo();
        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(0);
    });

    it('should be able to undo and redo appending segments ', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 5, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 3, 0.5);

        profile.appendSegment(accelSegment2);

        var allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(2);

        //perform the undo operation
        profile.undo();

        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(1);
        expect(allSegments[0]).toBe(accelSegment1);

        profile.undo();
        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(0);


        profile.redo();
        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(1);
        expect(allSegments[0]).toBe(accelSegment1);

        profile.redo();
        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(2);
        expect(allSegments[0]).toBe(accelSegment1);
        expect(allSegments[1]).toBe(accelSegment2);
    });

    it('should be able to undo and redo deleting segments ', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 5, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 3, 0.5);

        profile.appendSegment(accelSegment2);

        var allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(2);

        profile.deleteSegment(accelSegment2.id);
        profile.deleteSegment(accelSegment1.id);

        expect(profile.getAllSegments().length).toBe(0);

        profile.undo();
        profile.undo();

        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(2);
        expect(allSegments[0]).toBe(accelSegment1);
        expect(allSegments[1]).toBe(accelSegment2);

        profile.redo(); //redoing the second delete operation
        allSegments = profile.getAllSegments();
        expect(allSegments[0]).toBe(accelSegment1);

        profile.redo();
        //redoing the first delete operation, should have no segments
        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(0);
    });

    it('should insert a segment in between two other segments, then undo and redo', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        profile.appendSegment(accelSegment2);

        var accelSegment3 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 5, 0, 0.5);

        profile.insertSegment(accelSegment3, accelSegment2.id);

        //undo the insert operation
        profile.undo();

        //after inserting, there should be 3 segments total
        expect(profile.getAllSegments().length).toBe(2);

        var allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(2);
        expect(allSegments[0]).toBe(accelSegment1);
        expect(allSegments[1]).toBe(accelSegment2);

        //redo the insert operation
        profile.redo();
        allSegments = profile.getAllSegments();
        expect(allSegments.length).toBe(3);
        expect(allSegments[0]).toBe(accelSegment1);
        expect(allSegments[1]).toBe(accelSegment3);
        expect(allSegments[2]).toBe(accelSegment2);
    });

    it("should be able to modify final position and then undo and redo it", function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = motionProfileFactory.createAccelSegment("time-distance", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            pf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);

        var sameSeg = profile.getAllSegments()[0];

        //we should get back the same segment that we just created
        expect(sameSeg).toBe(seg1);

        profile.modifySegmentValues(sameSeg.id, {
            distance: 2.5
        }, {
            position: 0,
            velocity: 0
        });

        // make sure expected final values are still valid
        var finalValues = sameSeg.getFinalValues();


        expect(finalValues.position).toBe(2.5);
        expect(finalValues.velocity).toBe(2.5);

        //undo modify operation
        profile.undo();

        sameSeg = profile.getAllSegments()[0];
        finalValues = sameSeg.getFinalValues();

        //back to the original
        expect(finalValues.position).toBe(5);
    });


    it('should be able to append an index segment to an empty profile, then delete it', function() {
        var profile = motionProfileFactory.createMotionProfile('linear');

        //(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {
        var indexSeg = indexSegmentFactory.Make(0, 1.25048, 0, 0.154, 0, null, null, 0.2, 1, null, null, 'trapezoid', 'incremental');

        expect(indexSeg.getAllSegments().length).toBe(6);

        profile.appendSegment(indexSeg);

        var sameSeg = profile.getAllSegments()[0];

        expect(sameSeg).toBe(indexSeg);

        profile.deleteSegment(sameSeg.id);

        expect(profile.getAllSegments().length).toBe(0);

        profile.undo();

        expect(profile.getAllSegments().length).toBe(1);
        expect(profile.getAllSegments()[0]).toBe(indexSeg);

        profile.redo();

        expect(profile.getAllSegments().length).toBe(0);

        profile.undo();
        var sameSeg2 = profile.getAllSegments()[0];

        expect(indexSeg).toBe(sameSeg2);
    });

    it('should be able to insert an accel segment before an index segment', function() {
        var profile = motionProfileFactory.createMotionProfile('rotary');

        //(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode)
        var indexSeg = indexSegmentFactory.Make(0, 1.25048, 0, 0.154, 0, null, null, 0.2, 1, null, null, 'trapezoid', 'incremental');

        expect(indexSeg.getAllSegments().length).toBe(6);

        profile.appendSegment(indexSeg);

        var firstIndexSeg = profile.getAllSegments()[0];
        expect(firstIndexSeg.evaluatePositionAt(0.47988481)).toBeCloseTo(0.0501486, 4);
        expect(firstIndexSeg.evaluateVelocityAt(0.6)).toBeCloseTo(0.184729, 4);
        expect(firstIndexSeg.getAllSegments()[4].evaluateVelocityAt(0.992956)).toBeCloseTo(0.1307183, 4);
        expect(firstIndexSeg.evaluateVelocityAt(0.992956)).toBeCloseTo(0.1307183, 4);

        expect(profile.getAllSegments().length).toBe(1);
        var accSeg = accelSegmentFactory.MakeFromTimeDistance(0, 1.57, 0, 0, 0.526, 0.4, 'incremental');
        profile.insertSegment(accSeg, indexSeg.id);
        expect(profile.segments.countSegments()).toBe(2);

        var allSegs = profile.getAllSegments();

        expect(allSegs.length).toBe(2);

        allSegs = profile.getAllSegments();

        expect(profile.segments.countSegments()).toBe(2);
        expect(allSegs[0].evaluateVelocityAt(0.8)).toBeCloseTo(0.3430342, 4);
        expect(allSegs[1].evaluateVelocityAt(2.206)).toBeCloseTo(-0.15030278, 4);
    });

    it('insert index segment between two accel segments (incremental and absolute)', function() {
        var profile = motionProfileFactory.createMotionProfile('linear');
        // (t0, tf, p0, v0, vf, jPct, mode, loads)
        var accSeg1 = profile.appendSegment(
            accelSegmentFactory.MakeFromTimeVelocity(
                0,
                1,
                0,
                0,
                77,
                0.12,
                'incremental'));

        // run tests on accSeg 1
        expect(accSeg1.evaluatePositionAt(0.74)).toBeCloseTo(20.6589, 4);
        expect(accSeg1.evaluatePositionAt(accSeg1.finalTime)).toBe(38.5);
        expect(accSeg1.evaluatePositionAt(1)).toBe(38.5);
        expect(accSeg1.evaluatePositionAt(0.6)).toBeCloseTo(13.3193617, 4);

        // (t0, tf, p0, v0, pf, jPct, mode, loads)
        var accSeg2 = profile.appendSegment(
            accelSegmentFactory.MakeFromTimeDistance(
                accSeg1.finalTime, // t0
                13, // tf
                accSeg1.evaluatePositionAt(accSeg1.finalTime), // p0
                accSeg1.evaluateVelocityAt(accSeg1.finalTime), // v0
                58.5, // pf
                0.5, // jPct
                'absolute')); // mode

        // rerun exact same tests on accSeg1
        expect(accSeg1.evaluatePositionAt(0.74)).toBeCloseTo(20.6589, 4);
        expect(accSeg1.evaluatePositionAt(accSeg1.finalTime)).toBe(38.5);
        expect(accSeg1.evaluatePositionAt(1)).toBe(38.5);
        expect(accSeg1.evaluatePositionAt(0.6)).toBeCloseTo(13.3193617, 4);

        // run tests on accSeg2
        expect(accSeg2.finalTime).toBe(13);
        expect(accSeg2.evaluatePositionAt(accSeg2.finalTime)).toBeCloseTo(58.5, 4);
        expect(accSeg2.evaluatePositionAt(7.0995575)).toBeCloseTo(324.80518657, 4);

        // (t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode)
        var indexSeg1 = profile.insertSegment(
            indexSegmentFactory.Make(
                accSeg1.finalTime, // t0
                accSeg1.finalTime + 1.67, // tf
                accSeg1.evaluatePositionAt(accSeg1.finalTime), // p0
                accSeg1.evaluatePositionAt(accSeg1.finalTime) + 12, // pf
                accSeg1.evaluateVelocityAt(accSeg1.finalTime), // v
                null, // velLimPos
                null, // velLimNeg
                0.1, // accJerk
                0.5, // decJerk
                0.3, // xSkew
                0.27, // ySkew
                'trapezoid', // shape
                'incremental'), // mode
            accSeg2.id);

        // get segments after inserting indexSegment
        var accSeg1B = profile.getAllSegments()[0];
        var indexSeg1B = profile.getAllSegments()[1];
        var accSeg2B = profile.getAllSegments()[2];

        // index seg start and end time
        expect(indexSeg1B.initialTime).toBe(1);
        expect(indexSeg1B.finalTime).toBe(2.67);

        // index seg start, end, and middle position
        expect(indexSeg1B.evaluatePositionAt(1)).toBe(38.5);
        expect(indexSeg1B.evaluatePositionAt(1.5)).toBeCloseTo(53.12942, 4);
        expect(indexSeg1B.evaluatePositionAt(2.67)).toBeCloseTo(50.5, 4);

        // index seg start, middle, and end velocity
        expect(indexSeg1B.evaluateVelocityAt(1)).toBeCloseTo(77, 10);
        expect(indexSeg1B.evaluateVelocityAt(1.5)).toBeCloseTo(-11.66425, 4);
        expect(indexSeg1B.evaluateVelocityAt(2.67)).toBeCloseTo(77, 10);

        // index seg early, middle, and late acceleration
        expect(indexSeg1B.evaluateAccelerationAt(1.2)).toBeCloseTo(-202.211, 3);
        expect(indexSeg1B.evaluateAccelerationAt(1.85)).toBe(0);
        expect(indexSeg1B.evaluateAccelerationAt(2.55)).toBeCloseTo(475.678, 3);

        // accSeg2 intial and final time
        expect(accSeg2B.initialTime).toBe(2.67);
        expect(accSeg2B.finalTime).toBe(13);

        // accSeg2 start, middle, and end position
        expect(accSeg2B.evaluatePositionAt(2.67)).toBeCloseTo(50.5, 4);
        expect(accSeg2B.evaluatePositionAt(8.001514035)).toBeCloseTo(294.953658, 4);
        expect(accSeg2B.evaluatePositionAt(13)).toBeCloseTo(58.5, 4); // this value is wrong

        // accSeg2 start and end velocity
        expect(accSeg2B.evaluateVelocityAt(2.67)).toBeCloseTo(77, 10);
        expect(accSeg2B.evaluateVelocityAt(8)).toBeCloseTo(-2.4723373, 4);
        expect(accSeg2B.evaluateVelocityAt(13)).toBeCloseTo(-75.4511, 4); // this value is wrong

        expect(accSeg2B.evaluateAccelerationAt(8)).toBeCloseTo(-19.6775, 4);
        // expect(indexSeg.evaluatePositionAt(indexSeg.finalTime)).toBeCloseTo(50.5);
        // expect(indexSeg.evaluatePositionAt(indexSeg.initialTime)).toBe(38.5);
        // expect(accSeg2.evaluatePositionAt(accSeg2.initialTime)).toBeCloseTo(50.5, 4);
        // expect(accSeg2.evaluatePositionAt(accSeg2.finalTime)).toBeCloseTo(124, 4);
        // expect(accSeg2.evaluatePositionAt(8.8)).toBeCloseTo(274.64365, 4);
        // expect(accSeg2.evaluateVelocityAt(8.8)).toBeCloseTo(-21.0651, 4);
    });

    it('should clear the profile, leaving no segments', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment1 = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSegment1);

        var accelSegment2 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        profile.appendSegment(accelSegment2);

        var accelSegment3 = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 5, 0, 0.5);

        profile.insertSegment(accelSegment3, accelSegment2.id);


        //after inserting, there should be 3 segments total
        expect(profile.getAllSegments().length).toBe(3);

        profile.clear();
        expect(profile.getAllSegments().length).toBe(0);
    });
});


describe('Unit: Profile Exporting', function () {
    var motionProfileFactory = require('../lib/profile/motionProfile');
    var accelSegmentFactory = require('../lib/segments/accelSegment');
    var indexSegmentFactory = require('../lib/segments/indexSegment');
    var fastMath = require('../lib/util/fastMath');
    it('should create a profile with only a cam segment', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var camSeg = motionProfileFactory.createCamSegment(0, 0, 0);

        profile.appendSegment(camSeg);

        expect(profile.getAllSegments().length).toBe(1);

        expect(profile.evaluatePositionAt(0.5)).toBe(0.5);
        expect(profile.evaluateVelocityAt(0.5)).toBe(1.5);

    });


    it('should create a profile with two cam segments', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var camSeg1 = motionProfileFactory.createCamSegment(0, 0, 0);
        var finVal1 = camSeg1.getFinalValues();

        var camSeg2 = motionProfileFactory.createCamSegment(finVal1[0], finVal1[3], finVal1[2]);

        profile.appendSegment(camSeg1);
        profile.appendSegment(camSeg2);

        expect(profile.getAllSegments().length).toBe(2);

        expect(profile.evaluatePositionAt(0.5)).toBe(0.5);
        expect(profile.evaluateVelocityAt(0.5)).toBe(1.5);

        expect(profile.evaluateVelocityAt(1.5)).toBe(1.5);
        expect(profile.evaluatePositionAt(1.5)).toBe(1.5);

    });

    it('should create a profile with an accel segment and  two cam segments', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSeg  = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSeg);


        var camSeg1 = motionProfileFactory.createCamSegment(0, 0, 0);
        profile.appendSegment(camSeg1);

        var finVal1 = camSeg1.getFinalValues();

        var camSeg2 = motionProfileFactory.createCamSegment(finVal1[0], finVal1[3], finVal1[2]);


        profile.appendSegment(camSeg2);

        expect(profile.getAllSegments().length).toBe(3);

        expect(profile.evaluatePositionAt(0.5)).toBeCloseTo(0.277777777777,6);
        expect(profile.evaluateVelocityAt(0.5)).toBeCloseTo(1.66666667,5);

        expect(profile.evaluateVelocityAt(2.5)).toBe(-1);
        expect(profile.evaluatePositionAt(2.5)).toBe(11.75);

    });


    it('should create a profile with an accel segment and  two cam segments, then delete the accel segment', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSeg  = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSeg);


        var camSeg1 = motionProfileFactory.createCamSegment(0, 0, 0);
        profile.appendSegment(camSeg1);

        var finVal1 = camSeg1.getFinalValues();

        var camSeg2 = motionProfileFactory.createCamSegment(finVal1[0], finVal1[3], finVal1[2]);


        profile.appendSegment(camSeg2);

        expect(profile.getAllSegments().length).toBe(3);

        expect(profile.evaluatePositionAt(0.5)).toBeCloseTo(0.277777777777,6);
        expect(profile.evaluateVelocityAt(0.5)).toBeCloseTo(1.66666667,5);

        expect(profile.evaluateVelocityAt(2.5)).toBe(-1);
        expect(profile.evaluatePositionAt(2.5)).toBe(11.75);


        expect(profile.evaluateVelocityAt(3.5)).toBe(1.5);


        profile.deleteSegment(accelSeg.id);

        expect(profile.evaluatePositionAt(0.5)).toBe(0.5);
        expect(profile.evaluateVelocityAt(0.5)).toBe(1.5);

        expect(profile.evaluateVelocityAt(1.5)).toBe(1.5);
        expect(profile.evaluatePositionAt(1.5)).toBe(1.5);
    });


    it('should create a profile with an accel segment and  two cam segments, then delete the accel segment, then undo and redo', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSeg  = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        profile.appendSegment(accelSeg);


        var camSeg1 = motionProfileFactory.createCamSegment(0, 0, 0);
        profile.appendSegment(camSeg1);

        var finVal1 = camSeg1.getFinalValues();

        var camSeg2 = motionProfileFactory.createCamSegment(finVal1[0], finVal1[3], finVal1[2]);


        profile.appendSegment(camSeg2);

        expect(profile.getAllSegments().length).toBe(3);

        expect(profile.evaluatePositionAt(0.5)).toBeCloseTo(0.277777777777,6);
        expect(profile.evaluateVelocityAt(0.5)).toBeCloseTo(1.66666667,5);

        expect(profile.evaluateVelocityAt(2.5)).toBe(-1);
        expect(profile.evaluatePositionAt(2.5)).toBe(11.75);


        expect(profile.evaluateVelocityAt(3.5)).toBe(1.5);


        //delete the segment
        profile.deleteSegment(accelSeg.id);

        //check to make sure deletion was successful
        expect(profile.evaluatePositionAt(0.5)).toBe(0.5);
        expect(profile.evaluateVelocityAt(0.5)).toBe(1.5);

        expect(profile.evaluateVelocityAt(1.5)).toBe(1.5);
        expect(profile.evaluatePositionAt(1.5)).toBe(1.5);

        // undo deletion
        profile.undo();

        expect(profile.getAllSegments().length).toBe(3);

        expect(profile.evaluatePositionAt(0.5)).toBeCloseTo(0.277777777777,6);
        expect(profile.evaluateVelocityAt(0.5)).toBeCloseTo(1.66666667,5);

        expect(profile.evaluateVelocityAt(2.5)).toBe(-1);
        expect(profile.evaluatePositionAt(2.5)).toBe(11.75);

        expect(profile.evaluateVelocityAt(3.5)).toBe(1.5);
    });

    it('Should export basic segments for an index segment', function () {
        var profile = motionProfileFactory.createMotionProfile('linear');

        var indexSeg1 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                //(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {
                t0: 0,
                tf: 1.25,
                p0: 0,
                pf: 2,
                v: 12.5,
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.2,
                decJerk: 1,
                xSkew: null,
                ySkew: null,
                shape: 'trapezoid',
                mode: 'absolute'
        }));

        var loadSeg1 = profile.createLoadSegment("FRICTION_COEFF", 0, 1.25, 0.02, 0.5);
        profile.addLoadSegment(loadSeg1);

        var pbs = profile.generateBasicSegments();
    });

    it('Should export an empty profile', function () {
        profile = motionProfileFactory.createMotionProfile('rotary');
        var x = profile.getAllBasicSegments();
        expect(x.length).toBe(0);
        var y = profile.generateBasicSegments();
        expect(y.length).toBe(0);
    });

    it('Should export a profile of an index segment and an accel segment and match the basic segments from V1', function () {
        var profile = motionProfileFactory.createMotionProfile('linear');

        profile.setInitialConditions(0, 6, 0, 0, 0);

        var indexSeg1 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                //(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {
                t0: 0,
                tf: 5.65,
                p0: 0,
                pf: 12,
                v: 6,
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.2,
                decJerk: 0.8,
                xSkew: null,
                ySkew: null,
                shape: 'trapezoid',
                mode: 'incremental'
            })
        );

        var accelSeg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-distance', {
                t0: indexSeg1.segmentData.finalTime,
                tf: 10,
                p0: indexSeg1.segmentData.finalPosition,
                v0: indexSeg1.segmentData.finalVelocity,
                pf: -2,
                jPct: 1,
                mode: 'absolute',
                loads: {
                    friction: 0.3,
                    thrust: 0,
                    load: 0
                }
            })
        );

        var loadSeg1 = profile.createLoadSegment("FRICTION_COEFF", 0, 4.55, 0.02, 0.13);
        profile.addLoadSegment(loadSeg1);

        var pbs = profile.generateBasicSegments();

        expect(pbs.length).toBe(10);

        expect(pbs[0].InitialVelocity).toBeCloseTo(6.0, 5);
        expect(pbs[0].FinalVelocity).toBeCloseTo(5.6769911504424773, 5);
        expect(pbs[0].InitialTime).toBeCloseTo(0, 5);
        expect(pbs[0].FinalTime).toBeCloseTo(0.188333, 5);
        expect(pbs[0].InitialAcceleration).toBeCloseTo(0, 5);
        expect(pbs[0].FinalAcceleration).toBeCloseTo(-3.4301824731772279, 5);
        expect(pbs[0].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[0].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[0].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[0].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[0].Jerk).toBeCloseTo(-18.213358264657828, 5);
        expect(pbs[0].InitialFriction).toBeCloseTo(0.02, 5);
        expect(pbs[0].FinalFriction).toBeCloseTo(0.024553113553113553, 5);
        expect(pbs[0].InitialPosition).toBeCloseTo(0, 5);
        expect(pbs[0].FinalPosition).toBeCloseTo(1.1097222222222223, 5);

        expect(pbs[1].InitialVelocity).toBeCloseTo(5.6769911504424773, 5);
        expect(pbs[1].FinalVelocity).toBeCloseTo(0.50884955752211969, 5);
        expect(pbs[1].InitialTime).toBeCloseTo(0.188333, 5);
        expect(pbs[1].FinalTime).toBeCloseTo(1.695, 5);
        expect(pbs[1].InitialAcceleration).toBeCloseTo(-3.4301824731772279, 5);
        expect(pbs[1].FinalAcceleration).toBeCloseTo(-3.4301824731772279, 5);
        expect(pbs[1].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[1].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[1].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[1].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[1].Jerk).toBeCloseTo(0, 5);
        expect(pbs[1].InitialFriction).toBeCloseTo(0.024553113553113553, 5);
        expect(pbs[1].FinalFriction).toBeCloseTo(0.06097802197802199, 5);
        expect(pbs[1].InitialPosition).toBeCloseTo(1.1097222222222223, 5);
        expect(pbs[1].FinalPosition).toBeCloseTo(5.7697222222222218, 5);

        expect(pbs[2].InitialVelocity).toBeCloseTo(0.50884955752211969, 5);
        expect(pbs[2].FinalVelocity).toBeCloseTo(0.18584070796459695, 5);
        expect(pbs[2].InitialTime).toBeCloseTo(1.695, 5);
        expect(pbs[2].FinalTime).toBeCloseTo(1.883333, 5);
        expect(pbs[2].InitialAcceleration).toBeCloseTo(-3.4301824731772279, 5);
        expect(pbs[2].FinalAcceleration).toBeCloseTo(-2.2204460492503131E-15, 5);
        expect(pbs[2].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[2].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[2].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[2].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[2].Jerk).toBeCloseTo(18.2133582646578, 5);
        expect(pbs[2].InitialFriction).toBeCloseTo(0.06097802197802199, 5);
        expect(pbs[2].FinalFriction).toBeCloseTo(0.065531135531135529, 5);
        expect(pbs[2].InitialPosition).toBeCloseTo(5.7697222222222218, 5);
        expect(pbs[2].FinalPosition).toBeCloseTo(5.8249999999999984, 5);

        expect(pbs[3].InitialVelocity).toBeCloseTo(0.18584070796459828, 5);
        expect(pbs[3].FinalVelocity).toBeCloseTo(0.18584070796459828, 5);
        expect(pbs[3].InitialTime).toBeCloseTo(1.883333, 5);
        expect(pbs[3].FinalTime).toBeCloseTo(3.766667, 5);
        expect(pbs[3].InitialAcceleration).toBeCloseTo(0, 5);
        expect(pbs[3].FinalAcceleration).toBeCloseTo(0, 5);
        expect(pbs[3].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[3].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[3].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[3].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[3].Jerk).toBeCloseTo(0, 5);
        expect(pbs[3].InitialFriction).toBeCloseTo(0.065531135531135529, 5);
        expect(pbs[3].FinalFriction).toBeCloseTo(0.11106227106227107, 5);
        expect(pbs[3].InitialPosition).toBeCloseTo(5.8249999999999984, 5);
        expect(pbs[3].FinalPosition).toBeCloseTo(6.1749999999999918, 5);

        expect(pbs[4].InitialVelocity).toBeCloseTo(0.18584070796459828, 5);
        expect(pbs[4].FinalVelocity).toBeCloseTo(2.1238938053097423, 5);
        expect(pbs[4].InitialTime).toBeCloseTo(3.766667, 5);
        expect(pbs[4].FinalTime).toBeCloseTo(4.52, 5);
        expect(pbs[4].InitialAcceleration).toBeCloseTo(0, 5);
        expect(pbs[4].FinalAcceleration).toBeCloseTo(5.1452737097658563, 5);
        expect(pbs[4].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[4].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[4].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[4].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[4].Jerk).toBeCloseTo(6.8300093, 5);
        expect(pbs[4].InitialFriction).toBeCloseTo(0.11106227106227107, 5);
        expect(pbs[4].FinalFriction).toBeCloseTo(0.12927472527472531, 5);
        expect(pbs[4].InitialPosition).toBeCloseTo(6.1749999999999918, 5);
        expect(pbs[4].FinalPosition).toBeCloseTo(6.80166666666666, 5);

        expect(pbs[5].InitialVelocity).toBeCloseTo(2.1238938053097423, 5);
        expect(pbs[5].FinalVelocity).toBeCloseTo(2.27825201660271, 5);
        expect(pbs[5].InitialTime).toBeCloseTo(4.52, 5);
        expect(pbs[5].FinalTime).toBeCloseTo(4.55, 5);
        expect(pbs[5].InitialAcceleration).toBeCloseTo(5.1452737097658563, 5);
        expect(pbs[5].FinalAcceleration).toBeCloseTo(5.1452737097658563, 5);
        expect(pbs[5].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[5].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[5].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[5].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[5].Jerk).toBeCloseTo(0, 5);
        expect(pbs[5].InitialFriction).toBeCloseTo(0.12927472527472531, 5);
        expect(pbs[5].FinalFriction).toBeCloseTo(0.13, 5);
        expect(pbs[5].InitialPosition).toBeCloseTo(6.80166666666666, 5);
        expect(pbs[5].FinalPosition).toBeCloseTo(6.8676988539953427, 5);

        expect(pbs[6].InitialVelocity).toBeCloseTo(2.27825201660271, 5);
        expect(pbs[6].FinalVelocity).toBeCloseTo(4.0619469026548742, 5);
        expect(pbs[6].InitialTime).toBeCloseTo(4.55, 5);
        expect(pbs[6].FinalTime).toBeCloseTo(4.896667, 5);
        expect(pbs[6].InitialAcceleration).toBeCloseTo(5.1452737097658563, 5);
        expect(pbs[6].FinalAcceleration).toBeCloseTo(5.1452737097658563, 5);
        expect(pbs[6].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[6].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[6].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[6].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[6].Jerk).toBeCloseTo(0, 5);
        expect(pbs[6].InitialFriction).toBeCloseTo(0.13, 5);
        expect(pbs[6].FinalFriction).toBeCloseTo(0, 5);
        expect(pbs[6].InitialPosition).toBeCloseTo(6.8676988539953427, 5);
        expect(pbs[6].FinalPosition).toBeCloseTo(7.966666666666657, 5);

        expect(pbs[7].InitialVelocity).toBeCloseTo(4.0619469026548742, 5);
        expect(pbs[7].FinalVelocity).toBeCloseTo(6.0000000000000142, 5);
        expect(pbs[7].InitialTime).toBeCloseTo(4.896667, 5);
        expect(pbs[7].FinalTime).toBeCloseTo(5.65, 5);
        expect(pbs[7].InitialAcceleration).toBeCloseTo(5.1452737097658563, 5);
        expect(pbs[7].FinalAcceleration).toBeCloseTo(-2.6645352591003757E-15, 5);
        expect(pbs[7].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[7].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[7].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[7].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[7].Jerk).toBeCloseTo(-6.8300093, 5);
        expect(pbs[7].InitialFriction).toBeCloseTo(0, 5);
        expect(pbs[7].FinalFriction).toBeCloseTo(0, 5);
        expect(pbs[7].InitialPosition).toBeCloseTo(7.966666666666657, 5);
        expect(pbs[7].FinalPosition).toBeCloseTo(12.000000000000005, 5);

        expect(pbs[8].InitialVelocity).toBeCloseTo(6.0000000000000142, 5);
        expect(pbs[8].FinalVelocity).toBeCloseTo(-3.2183908045977, 5);
        expect(pbs[8].InitialTime).toBeCloseTo(5.65, 5);
        expect(pbs[8].FinalTime).toBeCloseTo(7.825, 5);
        expect(pbs[8].InitialAcceleration).toBeCloseTo(0, 5);
        expect(pbs[8].FinalAcceleration).toBeCloseTo(-8.4766811996300842, 5);
        expect(pbs[8].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[8].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[8].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[8].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[8].Jerk).toBeCloseTo(-3.8973246894850915, 5);
        expect(pbs[8].InitialFriction).toBeCloseTo(0, 5);
        expect(pbs[8].FinalFriction).toBeCloseTo(0, 5);
        expect(pbs[8].InitialPosition).toBeCloseTo(12.000000000000005, 5);
        expect(pbs[8].FinalPosition).toBeCloseTo(18.366666666666688, 5);

        expect(pbs[9].InitialVelocity).toBeCloseTo(-3.2183908045977, 5);
        expect(pbs[9].FinalVelocity).toBeCloseTo(-12.436781609195418, 5);
        expect(pbs[9].InitialTime).toBeCloseTo(7.825, 5);
        expect(pbs[9].FinalTime).toBeCloseTo(10, 5);
        expect(pbs[9].InitialAcceleration).toBeCloseTo(-8.4766811996300842, 5);
        expect(pbs[9].FinalAcceleration).toBeCloseTo(0, 5);
        expect(pbs[9].InitialLoad).toBeCloseTo(0, 5);
        expect(pbs[9].FinalLoad).toBeCloseTo(0, 5);
        expect(pbs[9].InitialThrust).toBeCloseTo(0, 5);
        expect(pbs[9].FinalThrust).toBeCloseTo(0, 5);
        expect(pbs[9].Jerk).toBeCloseTo(3.8973246894850915, 5);
        expect(pbs[9].InitialFriction).toBeCloseTo(0, 5);
        expect(pbs[9].FinalFriction).toBeCloseTo(0, 5);
        expect(pbs[9].InitialPosition).toBeCloseTo(18.366666666666688, 5);
        expect(pbs[9].FinalPosition).toBeCloseTo(-2.0, 5);
    });

    xit('should convert a profile from v1', function () {
        var mp = {
          "Id": 432468,
          "Name": "Motion Profile",
          "OwnerId": 14320,
          "LockedById": null,
          "LockExpirationDate": null,
          "DateCreated": "2017-03-30T15:07:41.2955994",
          "LastModifiedDate": "2017-04-04T14:01:03.4132987",
          "LibraryItemType": "Linear Profile",
          "IsDeleted": false,
          "IsGlobal": false,
          "Description": null,
          "DocumentId": null,
          "DocumentCreationDate": null,
          "SelfOrAncestorLockedById": null,
          "SelfOrAncestorGlobal": null,
          "SelfOrAncestorLockExpirationDate": null,
          "RequiresLock": false,
          "InitialVelocity": 6.0,
          "AxisId": 432467,
          "ProfileJson": "{\"loads\":{\"Load force 1\":{\"name\":\"Load force 1\",\"type\":\"FORCE\",\"points\":[{\"time\":0,\"force\":0},{\"time\":1927,\"force\":18.691},{\"time\":3374,\"force\":6.287},{\"time\":4259,\"force\":24.309}]},\"Load friction_coefficient 1\":{\"name\":\"Load friction_coefficient 1\",\"type\":\"FRICTION_COEFFICIENT\",\"points\":[{\"time\":0,\"friction\":0.02},{\"time\":4550,\"friction\":0.13},{\"time\":4721,\"friction\":0.909},{\"time\":5145,\"friction\":0.872},{\"time\":5357,\"friction\":0.646},{\"time\":5501,\"friction\":0.353},{\"time\":5706,\"friction\":0.046},{\"time\":5956,\"friction\":0.88},{\"time\":10936,\"friction\":0.352}]},\"dfghj\":{\"name\":\"dfghj\",\"type\":\"FORCE\",\"points\":[{\"time\":0,\"force\":26.914893617021278},{\"time\":1193,\"force\":18.036},{\"time\":2722,\"force\":10.781}]},\"kkkkkk\":{\"name\":\"kkkkkk\",\"type\":\"WEIGHT\",\"points\":[{\"time\":0,\"mass\":0},{\"time\":254,\"mass\":11.876},{\"time\":2722,\"mass\":39.961},{\"time\":3994,\"mass\":33.818},{\"time\":4550,\"mass\":12.315297872340429},{\"time\":16014,\"mass\":28.201}]}},\"motion\":{\"name\":\"motion\",\"type\":\"motion\",\"points\":[{\"time\":0,\"position\":0,\"velocity\":6,\"acceleration\":0,\"jerk\":0,\"smoothness\":0.5},{\"time\":5538,\"position\":12,\"velocity\":6.0000000000000426,\"acceleration\":0,\"jerk\":-7.030282091308119,\"smoothness\":0.5,\"segmentParameters\":{\"type\":\"Trapezoidal\",\"segmentType\":\"IndexSegment\",\"jerkAccelerationPercent\":20,\"jerkDecelerationPercent\":80,\"specifyVelocityLimit\":false,\"absoluteVelocityLimit\":0,\"positiveVelocityLimit\":0,\"negativeVelocityLimit\":0}},{\"time\":8035,\"position\":-1.1497100910995215,\"velocity\":-16.532406961233139,\"acceleration\":0,\"jerk\":14.455412629706347,\"smoothness\":1},{\"time\":9852,\"position\":9.8314997275039,\"velocity\":28.619594433553889,\"acceleration\":0,\"jerk\":-72.9400201259283,\"smoothness\":0.5},{\"time\":11418,\"position\":10.234784778396243,\"velocity\":39.029571268756115,\"acceleration\":-8.5265128291212022E-13,\"jerk\":-471.964774897913,\"smoothness\":0.5,\"segmentParameters\":{\"type\":\"Triangular\",\"segmentType\":\"IndexSegment\",\"jerkAccelerationPercent\":20,\"jerkDecelerationPercent\":100,\"specifyVelocityLimit\":true,\"absoluteVelocityLimit\":45,\"positiveVelocityLimit\":45,\"negativeVelocityLimit\":-45}},{\"time\":12327,\"position\":45.712665061692164,\"velocity\":39.0295712687486,\"acceleration\":-2704.1979658615678,\"jerk\":68590.198656697787,\"smoothness\":0.5},{\"time\":13327,\"position\":46.712665061692157,\"velocity\":-3.4694469519536142E-18,\"acceleration\":0.14994843779432709,\"jerk\":18.288656267647596,\"smoothness\":0.5,\"segmentParameters\":{\"initialDuration\":1000,\"segmentType\":\"CamSegment\",\"transformedDuration\":-1,\"camModel\":{\"rawProfileData\":\"0\\t0\\tCubic\\n0.05\\t0.000193578125\\tCubic\\n0.1\\t0.002728\\tCubic\\n0.15\\t0.012103171875\\tCubic\\n0.2\\t0.033344\\tCubic\\n0.25\\t0.070556640625\\tCubic\\n0.3\\t0.126036\\tCubic\\n0.35\\t0.199845734375\\tCubic\\n0.4\\t0.289792\\tCubic\\n0.45\\t0.391712203125\\tCubic\\n0.5\\t0.5\\tCubic\\n0.55\\t0.608287796875\\tCubic\\n0.6\\t0.710208\\tCubic\\n0.65\\t0.800154265625\\tCubic\\n0.7\\t0.873964\\tCubic\\n0.75\\t0.929443359375\\tCubic\\n0.8\\t0.966656\\tCubic\\n0.85\\t0.987896828125002\\tCubic\\n0.9\\t0.997272\\tCubic\\n0.95\\t0.999806421874998\\tCubic\\n1\\t1\\tCubic\",\"parsedCamProfile\":[{\"MasterMU\":12.327,\"SlaveSU\":45.712665061683573,\"Type\":\"Cubic\",\"SlopeSUMU\":39.0295712688,\"isValid\":true},{\"MasterMU\":12.377,\"SlaveSU\":45.712858639808573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.427,\"SlaveSU\":45.715393061683571,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.477,\"SlaveSU\":45.724768233558571,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.527,\"SlaveSU\":45.746009061683573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.577,\"SlaveSU\":45.783221702308573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.627,\"SlaveSU\":45.838701061683572,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.677,\"SlaveSU\":45.912510796058577,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.727,\"SlaveSU\":46.002457061683572,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.777,\"SlaveSU\":46.104377264808576,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.827,\"SlaveSU\":46.212665061683573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.877,\"SlaveSU\":46.32095285855857,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.927,\"SlaveSU\":46.422873061683575,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.977,\"SlaveSU\":46.51281932730857,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.027,\"SlaveSU\":46.586629061683574,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.077,\"SlaveSU\":46.642108421058573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.127,\"SlaveSU\":46.679321061683574,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.177,\"SlaveSU\":46.700561889808576,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.227,\"SlaveSU\":46.709937061683576,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.277,\"SlaveSU\":46.712471483558573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.327,\"SlaveSU\":46.712665061683573,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true}],\"convertedCamProfile\":[{\"MasterMU\":12.327,\"SlaveSU\":45.712665061692164,\"Type\":\"Cubic\",\"SlopeSUMU\":39.0295712687486,\"isValid\":true},{\"MasterMU\":12.377,\"SlaveSU\":45.712858639817163,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.427,\"SlaveSU\":45.715393061692161,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.477,\"SlaveSU\":45.724768233567161,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.527,\"SlaveSU\":45.746009061692163,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.577,\"SlaveSU\":45.783221702317164,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.627,\"SlaveSU\":45.838701061692163,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.677,\"SlaveSU\":45.912510796067167,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.727,\"SlaveSU\":46.002457061692162,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.777,\"SlaveSU\":46.104377264817167,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.827,\"SlaveSU\":46.212665061692164,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.877,\"SlaveSU\":46.320952858567161,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.927,\"SlaveSU\":46.422873061692165,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":12.977,\"SlaveSU\":46.51281932731716,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.027,\"SlaveSU\":46.586629061692165,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.077,\"SlaveSU\":46.642108421067164,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.127,\"SlaveSU\":46.679321061692164,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.177,\"SlaveSU\":46.700561889817166,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.227,\"SlaveSU\":46.709937061692166,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.277,\"SlaveSU\":46.712471483567164,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true},{\"MasterMU\":13.327,\"SlaveSU\":46.712665061692164,\"Type\":\"Cubic\",\"SlopeSUMU\":0,\"isValid\":true}],\"subSegmentComponents\":[{\"t0\":12327,\"tf\":12377,\"duration\":50.000000000000711,\"p\":45.712665061692164,\"v\":39.0295712687486,\"a\":-1352.0989829307839,\"j\":11431.699776116297,\"originalComponent\":{\"t0\":12327,\"tf\":12377,\"duration\":50.000000000000711,\"p\":45.712665061685946,\"v\":39.0295712687486,\"a\":-1352.0989829307839,\"j\":11431.699776116297,\"originalComponent\":{\"p\":45.712665061683573,\"v\":39.0295712688,\"a\":-1352.0989829325645,\"j\":11431.699776131347,\"t0\":12.327,\"tf\":12.377,\"duration\":0.050000000000000711}}},{\"t0\":12377,\"tf\":12427,\"duration\":49.999999999998934,\"p\":45.712858639817163,\"v\":-10.44257870345705,\"a\":362.65598348668482,\"j\":-3055.8128133508685,\"originalComponent\":{\"t0\":12377,\"tf\":12427,\"duration\":49.999999999998934,\"p\":45.712858639810946,\"v\":-10.44257870345705,\"a\":362.65598348668482,\"j\":-3055.8128133508685,\"originalComponent\":{\"p\":45.712858639808573,\"v\":-10.442578703470824,\"a\":362.6559834871619,\"j\":-3055.8128133549012,\"t0\":12.377,\"tf\":12.427,\"duration\":0.049999999999998934}}},{\"t0\":12427,\"tf\":12477,\"duration\":50.000000000000711,\"p\":45.715393061692161,\"v\":2.9044235450801219,\"a\":-95.715938515935676,\"j\":827.55072728666676,\"originalComponent\":{\"t0\":12427,\"tf\":12477,\"duration\":50.000000000000711,\"p\":45.715393061685944,\"v\":2.9044235450801219,\"a\":-95.715938515935676,\"j\":827.55072728666676,\"originalComponent\":{\"p\":45.715393061683571,\"v\":2.9044235450838118,\"a\":-95.7159385160635,\"j\":827.55072728774735,\"t0\":12.427,\"tf\":12.477,\"duration\":0.050000000000000711}}},{\"t0\":12477,\"tf\":12527,\"duration\":49.999999999998934,\"p\":45.724768233567161,\"v\":-0.46053985186340535,\"a\":28.4166705770661,\"j\":-214.19084579593684,\"originalComponent\":{\"t0\":12477,\"tf\":12527,\"duration\":49.999999999998934,\"p\":45.724768233560944,\"v\":-0.46053985186340535,\"a\":28.4166705770661,\"j\":-214.19084579593684,\"originalComponent\":{\"p\":45.724768233558571,\"v\":-0.46053985186439422,\"a\":28.416670577100355,\"j\":-214.1908457962264,\"t0\":12.477,\"tf\":12.527,\"duration\":0.049999999999998934}}},{\"t0\":12527,\"tf\":12577,\"duration\":50.000000000000711,\"p\":45.746009061692163,\"v\":0.77469586237368626,\"a\":-3.7119562923237419,\"j\":62.061905896998624,\"originalComponent\":{\"t0\":12527,\"tf\":12577,\"duration\":50.000000000000711,\"p\":45.746009061685946,\"v\":0.77469586237368626,\"a\":-3.7119562923237419,\"j\":62.061905896998624,\"originalComponent\":{\"p\":45.746009061683573,\"v\":0.77469586237395127,\"a\":-3.7119562923329203,\"j\":62.061905897076215,\"t0\":12.527,\"tf\":12.577,\"duration\":0.050000000000000711}}},{\"t0\":12577,\"tf\":12627,\"duration\":50.000000000000711,\"p\":45.783221702317164,\"v\":0.86896452736880969,\"a\":5.5973295922261848,\"j\":-15.697527792061818,\"originalComponent\":{\"t0\":12577,\"tf\":12627,\"duration\":50.000000000000711,\"p\":45.783221702310946,\"v\":0.86896452736880969,\"a\":5.5973295922261848,\"j\":-15.697527792061818,\"originalComponent\":{\"p\":45.783221702308573,\"v\":0.86896452736873875,\"a\":5.5973295922286441,\"j\":-15.697527792082607,\"t0\":12.577,\"tf\":12.627,\"duration\":0.050000000000000711}}},{\"t0\":12627,\"tf\":12677,\"duration\":49.999999999998934,\"p\":45.838701061692163,\"v\":1.310966028150969,\"a\":3.2427004234168786,\"j\":1.2374552713221354,\"originalComponent\":{\"t0\":12627,\"tf\":12677,\"duration\":49.999999999998934,\"p\":45.838701061685946,\"v\":1.310966028150969,\"a\":3.2427004234168786,\"j\":1.2374552713221354,\"originalComponent\":{\"p\":45.838701061683572,\"v\":1.3109660281509878,\"a\":3.2427004234162196,\"j\":1.2374552713277043,\"t0\":12.627,\"tf\":12.677,\"duration\":0.049999999999998934}}},{\"t0\":12677,\"tf\":12727,\"duration\":50.000000000000711,\"p\":45.912510796067167,\"v\":1.6445169850275654,\"a\":3.428318714115195,\"j\":-6.8030432933795035,\"originalComponent\":{\"t0\":12677,\"tf\":12727,\"duration\":50.000000000000711,\"p\":45.91251079606095,\"v\":1.6445169850275654,\"a\":3.428318714115195,\"j\":-6.8030432933795035,\"originalComponent\":{\"p\":45.912510796058577,\"v\":1.6445169850275603,\"a\":3.4283187141153713,\"j\":-6.8030432933809957,\"t0\":12.677,\"tf\":12.727,\"duration\":0.050000000000000711}}},{\"t0\":12727,\"tf\":12777,\"duration\":49.999999999998934,\"p\":46.002457061692162,\"v\":1.9363260317387419,\"a\":2.4078622201082549,\"j\":-7.3260320976069062,\"originalComponent\":{\"t0\":12727,\"tf\":12777,\"duration\":49.999999999998934,\"p\":46.002457061685945,\"v\":1.9363260317387419,\"a\":2.4078622201082549,\"j\":-7.3260320976069062,\"originalComponent\":{\"p\":46.002457061683572,\"v\":1.9363260317387434,\"a\":2.4078622201082074,\"j\":-7.3260320976065048,\"t0\":12.727,\"tf\":12.777,\"duration\":0.049999999999998934}}},{\"t0\":12777,\"tf\":12827,\"duration\":50.000000000000711,\"p\":46.104377264817167,\"v\":2.122167013017513,\"a\":1.3089574054672424,\"j\":-8.7435783163871577,\"originalComponent\":{\"t0\":12777,\"tf\":12827,\"duration\":50.000000000000711,\"p\":46.10437726481095,\"v\":2.122167013017513,\"a\":1.3089574054672424,\"j\":-8.7435783163871577,\"originalComponent\":{\"p\":46.104377264808576,\"v\":2.1221670130175125,\"a\":1.308957405467255,\"j\":-8.743578316387266,\"t0\":12.777,\"tf\":12.827,\"duration\":0.050000000000000711}}},{\"t0\":12827,\"tf\":12877,\"duration\":50.000000000000711,\"p\":46.212665061692164,\"v\":2.1874859161913331,\"a\":-0.0025793419908500454,\"j\":-8.6404046367531553,\"originalComponent\":{\"t0\":12827,\"tf\":12877,\"duration\":50.000000000000711,\"p\":46.212665061685946,\"v\":2.1874859161913331,\"a\":-0.0025793419908500454,\"j\":-8.6404046367531553,\"originalComponent\":{\"p\":46.212665061683573,\"v\":2.1874859161913336,\"a\":-0.002579341990853442,\"j\":-8.6404046367531251,\"t0\":12.827,\"tf\":12.877,\"duration\":0.050000000000000711}}},{\"t0\":12877,\"tf\":12927,\"duration\":49.999999999998934,\"p\":46.320952858567161,\"v\":2.1224249472165977,\"a\":-1.2986400375038416,\"j\":-7.6355531365089329,\"originalComponent\":{\"t0\":12877,\"tf\":12927,\"duration\":49.999999999998934,\"p\":46.320952858560943,\"v\":2.1224249472165977,\"a\":-1.2986400375038416,\"j\":-7.6355531365089329,\"originalComponent\":{\"p\":46.32095285855857,\"v\":2.1224249472165977,\"a\":-1.2986400375038407,\"j\":-7.6355531365089417,\"t0\":12.877,\"tf\":12.927,\"duration\":0.049999999999998934}}},{\"t0\":12927,\"tf\":12977,\"duration\":50.000000000000711,\"p\":46.422873061692165,\"v\":1.9352942949424019,\"a\":-2.4439730079801572,\"j\":-5.6681328174054384,\"originalComponent\":{\"t0\":12927,\"tf\":12977,\"duration\":50.000000000000711,\"p\":46.422873061685948,\"v\":1.9352942949424019,\"a\":-2.4439730079801572,\"j\":-5.6681328174054384,\"originalComponent\":{\"p\":46.422873061683575,\"v\":1.9352942949424019,\"a\":-2.4439730079801576,\"j\":-5.6681328174054348,\"t0\":12.927,\"tf\":12.977,\"duration\":0.050000000000000711}}},{\"t0\":12977,\"tf\":13027,\"duration\":49.999999999998934,\"p\":46.51281932731716,\"v\":1.6483859980138407,\"a\":-3.2941929305909849,\"j\":-2.9926655936722524,\"originalComponent\":{\"t0\":12977,\"tf\":13027,\"duration\":49.999999999998934,\"p\":46.512819327310943,\"v\":1.6483859980138407,\"a\":-3.2941929305909849,\"j\":-2.9926655936722524,\"originalComponent\":{\"p\":46.51281932730857,\"v\":1.6483859980138407,\"a\":-3.2941929305909849,\"j\":-2.9926655936722524,\"t0\":12.977,\"tf\":13.027,\"duration\":0.049999999999998934}}},{\"t0\":13027,\"tf\":13077,\"duration\":50.000000000000711,\"p\":46.586629061692165,\"v\":1.2965217130022082,\"a\":-3.7430927696418133,\"j\":0.08804519194091924,\"originalComponent\":{\"t0\":13027,\"tf\":13077,\"duration\":50.000000000000711,\"p\":46.586629061685947,\"v\":1.2965217130022082,\"a\":-3.7430927696418133,\"j\":0.08804519194091924,\"originalComponent\":{\"p\":46.586629061683574,\"v\":1.2965217130022082,\"a\":-3.7430927696418133,\"j\":0.08804519194091924,\"t0\":13.027,\"tf\":13.077,\"duration\":0.050000000000000711}}},{\"t0\":13077,\"tf\":13127,\"duration\":50.000000000000711,\"p\":46.642108421067164,\"v\":0.92287277497757847,\"a\":-3.7298859908506752,\"j\":3.1497348259820748,\"originalComponent\":{\"t0\":13077,\"tf\":13127,\"duration\":50.000000000000711,\"p\":46.642108421060946,\"v\":0.92287277497757847,\"a\":-3.7298859908506752,\"j\":3.1497348259820748,\"originalComponent\":{\"p\":46.642108421058573,\"v\":0.92287277497757847,\"a\":-3.7298859908506752,\"j\":3.1497348259820748,\"t0\":13.077,\"tf\":13.127,\"duration\":0.050000000000000711}}},{\"t0\":13127,\"tf\":13177,\"duration\":49.999999999998934,\"p\":46.679321061692164,\"v\":0.57350718708737192,\"a\":-3.2574257669533573,\"j\":5.6722655041372763,\"originalComponent\":{\"t0\":13127,\"tf\":13177,\"duration\":49.999999999998934,\"p\":46.679321061685947,\"v\":0.57350718708737192,\"a\":-3.2574257669533573,\"j\":5.6722655041372763,\"originalComponent\":{\"p\":46.679321061683574,\"v\":0.57350718708737192,\"a\":-3.2574257669533573,\"j\":5.6722655041372763,\"t0\":13.127,\"tf\":13.177,\"duration\":0.049999999999998934}}},{\"t0\":13177,\"tf\":13227,\"duration\":50.000000000000711,\"p\":46.700561889817166,\"v\":0.29030660167307093,\"a\":-2.4065859413327839,\"j\":7.0104531574260918,\"originalComponent\":{\"t0\":13177,\"tf\":13227,\"duration\":50.000000000000711,\"p\":46.700561889810949,\"v\":0.29030660167307093,\"a\":-2.4065859413327839,\"j\":7.0104531574260918,\"originalComponent\":{\"p\":46.700561889808576,\"v\":0.29030660167307093,\"a\":-2.4065859413327839,\"j\":7.0104531574260918,\"t0\":13.177,\"tf\":13.227,\"duration\":0.050000000000000711}}},{\"t0\":13227,\"tf\":13277,\"duration\":49.999999999998934,\"p\":46.709937061692166,\"v\":0.10222640622048626,\"a\":-1.3550179677188552,\"j\":6.48517186616562,\"originalComponent\":{\"t0\":13227,\"tf\":13277,\"duration\":49.999999999998934,\"p\":46.709937061685949,\"v\":0.10222640622048626,\"a\":-1.3550179677188552,\"j\":6.48517186616562,\"originalComponent\":{\"p\":46.709937061683576,\"v\":0.10222640622048626,\"a\":-1.3550179677188552,\"j\":6.48517186616562,\"t0\":13.227,\"tf\":13.277,\"duration\":0.049999999999998934}}},{\"t0\":13277,\"tf\":13327,\"duration\":50.000000000000711,\"p\":46.712471483567164,\"v\":0.015363398444843683,\"a\":-0.38224218779403285,\"j\":3.048109377941266,\"originalComponent\":{\"t0\":13277,\"tf\":13327,\"duration\":50.000000000000711,\"p\":46.712471483560947,\"v\":0.015363398444843683,\"a\":-0.38224218779403285,\"j\":3.048109377941266,\"originalComponent\":{\"p\":46.712471483558573,\"v\":0.015363398444843683,\"a\":-0.38224218779403285,\"j\":3.048109377941266,\"t0\":13.277,\"tf\":13.327,\"duration\":0.050000000000000711}}}],\"masterConversion\":1,\"slaveConversion\":1}}},{\"time\":14082,\"position\":55.742597351870344,\"velocity\":23.920350437558135,\"acceleration\":0,\"jerk\":-223.80632837795309,\"smoothness\":0.5},{\"time\":14650,\"position\":65.412242200681362,\"velocity\":10.127694804734176,\"acceleration\":0,\"jerk\":228.00792886371761,\"smoothness\":0.5}],\"calculationMode\":\"velocity\",\"maxPosition\":65.412242200681362,\"maxVelocity\":39.029571268756115,\"maxAcceleration\":725.31196697337009,\"maxJerk\":68590.198656697787,\"minPosition\":-8.6981625147484269,\"minVelocity\":-33.309531700590277,\"minAcceleration\":-2704.1979658615678,\"minJerk\":-1122.3515696587092},\"svg\":null,\"applicationTemplates\":{}}",
          "ProfileType": "MA",
          "ProfileVersion": "1.0",
          "SynchronizedProfileId": null,
          "SynchronizationOffsetTime": null,
          "VelocityId": null,
          "PositionId": null,
          "AccelerationId": null,
          "JerkId": null,
          "Inclination": 0.0,
          "FrictionCoefficient": 0.0
        };

        var profile = motionProfileFactory.convertV1ToV2(mp);

    });

    it('should be able create a profile with three segments, delete one, undo and get back to the original profile', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        var accelSegment = motionProfileFactory.createAccelSegment("time-velocity",
        {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 10,
            jPct: 0.5});

        profile.appendSegment(accelSegment);

        var accelSegment2 = motionProfileFactory.createAccelSegment("time-velocity",
        {
            t0: 2,
            tf: 3,
            p0: 0,
            v0: 0,
            vf: 7.5,
            jPct: 0.5});


        profile.appendSegment(accelSegment2);

        var accelSegment3 = motionProfileFactory.createAccelSegment("time-velocity",
        {
            t0: 3,
            tf: 5,
            p0: 0,
            v0: 0,
            vf: 10,
            jPct: 0.5});



        profile.appendSegment(accelSegment3);

        var json1=motionProfileFactory.serialize(profile);


        var segments1 = profile.getAllBasicSegments();


        var segData1=segments1.map(function(seg) {
            return seg.exportData();
        });


        profile.deleteSegment(accelSegment2.id);

        profile.undo();

        var json2=motionProfileFactory.serialize(profile);
        var segments2 = profile.getAllBasicSegments();

        expect(json1).toEqual(json2);




        var segData2=segments2.map(function(seg){
            return seg.exportData();
        });

        expect(segData1).toEqual(segData2);

    });
});