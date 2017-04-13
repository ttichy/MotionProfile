describe('Unit: profile serialization testing', function() {

    var motionProfileFactory = require('../lib/profile/motionProfile');

    it('should be able to serialize and deserialize profile with only AccelSegments', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        profile.setInitialConditions(1, 2);

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"
        });

        var seg2 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 2,
            tf: 5,
            p0: 0,
            v0: 0,
            vf: 0,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);
        profile.appendSegment(seg2);

        // serialize
        var json = motionProfileFactory.serialize(profile);

        var profileObj = JSON.parse(json);

        expect(profileObj.type).toBe("rotary");
        expect(profileObj.initialPosition).toBe(1);
        expect(profileObj.initialVelocity).toBe(2);

        var newProfile = motionProfileFactory.deserialize(json);

        expect(newProfile.getAllSegments()[1].evaluatePositionAt(5)).toBe(profile.getAllSegments()[1].evaluatePositionAt(5));
    });

    it('should be able to serialize and deserialize profile with only AccelSegments and load segments', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        profile.setInitialConditions(1, 2);

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"

        });

        var seg2 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 2,
            tf: 5,
            p0: 0,
            v0: 0,
            vf: 0,
            jPct: 0.5,
            mode: "incremental"
        });

        profile.appendSegment(seg1);
        profile.appendSegment(seg2);


        var loadSeg1 = motionProfileFactory.createLoadSegment("FRICTION", 0, 2, 1, 1);

        profile.addLoadSegment(loadSeg1);

        var newProfile = motionProfileFactory.serialize(profile);
    });

    it('should be able to serialize and deserialize profile with only AccelSegments and load segments', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        profile.setInitialConditions(1, 2);

        var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 0,
            tf: 2,
            p0: 0,
            v0: 0,
            vf: 5,
            jPct: 0.5,
            mode: "incremental"

        });

        var seg2 = motionProfileFactory.createAccelSegment("time-velocity", {
            t0: 2,
            tf: 5,
            p0: 0,
            v0: 0,
            vf: 0,
            jPct: 0.5,
            mode: "incremental"

        });

        profile.appendSegment(seg1);
        profile.appendSegment(seg2);


        var loadSeg1 = motionProfileFactory.createLoadSegment("FRICTION", 0, 2, 1, 1);

        profile.addLoadSegment(loadSeg1);

        var json = motionProfileFactory.serialize(profile);

        var profileObj = JSON.parse(json);

        expect(profileObj.loadSegments.length).toBe(1);
        expect(profileObj.segments.length).toBe(2);


        var newProfile = motionProfileFactory.deserialize(json);

        var allSegments = newProfile.getAllSegments();

        expect(allSegments.length).toBe(2);
        expect(newProfile.getAllSegments()[0].evaluatePositionAt(1.1)).toBe(profile.getAllSegments()[0].evaluatePositionAt(1.1));

        var loadSegments = profile.getAllLoadSegments();
        expect(loadSegments.length).toBe(1);
        expect(loadSegments[0].evaluateLoadAt(1)).toBe(loadSeg1.evaluateLoadAt(1));

    });

    it('should be able to serialize and deserialize profile with only index segments', function() {
        var profile = motionProfileFactory.createMotionProfile("linear");

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

        expect(indexSeg1.initialTime).toBe(0);
        expect(indexSeg1.finalTime).toBe(1.25);
        expect(profile.evaluateVelocityAt(0)).toBeCloseTo(12.5, 4);
        expect(profile.evaluateVelocityAt(1.25)).toBeCloseTo(12.5, 4);
        expect(profile.evaluateVelocityAt(1)).toBeCloseTo(1.3820, 4);

        var indexSeg2 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: 0,
                tf: 1.25,
                p0: 0,
                pf: 2,
                v: indexSeg1.evaluateVelocityAt(indexSeg1.finalTime),
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.2,
                decJerk: 1,
                xSkew: null,
                ySkew: null,
                shape: 'trapezoid',
                mode: 'incremental'
            }));

        // type, t0, tf, initialLoad, finalLoad
        var loadSeg1 = motionProfileFactory.createLoadSegment("FRICTION_COEFF", 0, 2, 0.02, 0.02);
        profile.addLoadSegment(loadSeg1);

        // console.dir(profile.getAllSegments());

        var profileJSON = motionProfileFactory.serialize(profile);
        // console.log(profileJSON);
        var reconstructedProfile = motionProfileFactory.deserialize(profileJSON);

        expect(reconstructedProfile.type).toBe("linear");
        expect(reconstructedProfile.evaluateVelocityAt(0)).toBeCloseTo(12.5, 4);
        expect(reconstructedProfile.evaluateVelocityAt(1.25)).toBeCloseTo(12.5, 4);
        expect(reconstructedProfile.evaluateVelocityAt(1)).toBeCloseTo(1.3820, 4);
        expect(reconstructedProfile.evaluateVelocityAt(1)).toBeCloseTo(1.3820, 4);
        // console.log(reconstructedProfile);
    });


    it('should serialize and deserialize a profile consisting of only cam segments', function() {

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


        var profileJSON = motionProfileFactory.serialize(profile);


        var reconstructedProfile = motionProfileFactory.deserialize(profileJSON);


        expect(reconstructedProfile.evaluatePositionAt(0.5)).toBe(0.5);
        expect(reconstructedProfile.evaluateVelocityAt(0.5)).toBe(1.5);

        expect(reconstructedProfile.evaluateVelocityAt(1.5)).toBe(1.5);
        expect(reconstructedProfile.evaluatePositionAt(1.5)).toBe(1.5);

    });


    it('should serialize and deserialize a profile consisting of only accel, index, and cam segment', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        profile.setInitialConditions(1, 2);

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

        var indexSeg2 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: 0,
                tf: 1.25,
                p0: 0,
                pf: 2,
                v: profile.evaluateVelocityAt(seg1.finalTime),
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.2,
                decJerk: 1,
                xSkew: null,
                ySkew: null,
                shape: 'trapezoid',
                mode: 'incremental'
            }));

        profile.appendSegment(
            motionProfileFactory.createCamSegment(0, 0, 0));


        var profileJson = motionProfileFactory.serialize(profile);

        var reconstructedProfile = motionProfileFactory.deserialize(profileJson);


        expect(reconstructedProfile.evaluatePositionAt(1.1)).toBe(profile.evaluatePositionAt(1.1));
        expect(reconstructedProfile.evaluatePositionAt(2.1)).toBe(profile.evaluatePositionAt(2.1));



    });

    it('should serialize and deserialize a profile consisting of an accel segment and a load segments', function() {

        var profile = motionProfileFactory.createMotionProfile("rotary");

        profile.setInitialConditions(1, 2);

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

        var loadSeg = motionProfileFactory.createLoadSegment("INERTIA", 0, 2, -1, 1);

        profile.addLoadSegment(loadSeg);



        var profileJSON = motionProfileFactory.serialize(profile);


        var recreatedProfile = motionProfileFactory.deserialize(profileJSON);


        var recLoadSeg = recreatedProfile.getAllLoadSegments("INERTIA")[0];

        expect(recLoadSeg.evaluateLoadAt(1.25)).toBe(loadSeg.evaluateLoadAt(1.25));


    });



    it('should export an empty profile', function() {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var x = profile.getAllBasicSegments();
    });


    it('Should export basic segments for an index segment', function() {
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

        var loadSeg1 = motionProfileFactory.createLoadSegment("FRICTION_COEFF", 0, 1.25, 0.02, 0.5);
        profile.addLoadSegment(loadSeg1);

        var pbs = profile.generateBasicSegments();
    });

    it('Should export an empty profile', function() {
        profile = motionProfileFactory.createMotionProfile('rotary');
        var x = profile.getAllBasicSegments();
        expect(x.length).toBe(0);
        var y = profile.generateBasicSegments();
        expect(y.length).toBe(0);
    });


});