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


        var loadSeg1 = profile.createLoadSegment("FRICTION", 0, 2, 1, 1);

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


        var loadSeg1 = profile.createLoadSegment("FRICTION", 0, 2, 1, 1);

        profile.addLoadSegment(loadSeg1);

        var json = motionProfileFactory.serialize(profile);

        var profileObj = JSON.parse(json);

        expect(profileObj.loadSegments.length).toBe(1);
        expect(profileObj.segments.length).toBe(2);


        var newProfile = motionProfileFactory.deserialize(json);

        var allSegments=newProfile.getAllSegments();

        expect(allSegments.length).toBe(2);
        expect(newProfile.getAllSegments()[0].evaluatePositionAt(1.1)).toBe(profile.getAllSegments()[0].evaluatePositionAt(1.1));

        var loadSegments=profile.getAllLoadSegments();
        expect(loadSegments.length).toBe(1);
        expect(loadSegments[0].evaluateLoadAt(1)).toBe(loadSeg1.evaluateLoadAt(1));

    });

    it('should be able to serialize and deserialize profile with only index segments', function () {
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

        // indexSeg1.getAllSegments().forEach(function (segment, i) {
        //     if (i == 5) {
        //         console.log(segment.initialTime);
        //         console.log(segment.finalTime);
        //         console.log(segment.initialVelocity);
        //         console.log(segment.finalVelocity);
        //         console.log(segment.evaluateVelocityAt(segment.finalTime));
        //         console.log(segment.evaluatePositionAt(segment.finalTime));
        //         console.log(segment.positionPoly);
        //         console.log(segment.velocityPoly);
        //     }
        // });
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
        var loadSeg1 = profile.createLoadSegment("FRICTION_COEFF", 0, 2, 0.02, 0.02);
        profile.addLoadSegment(loadSeg1);

        console.dir(profile.getAllSegments());

        var profileJSON = motionProfileFactory.serialize(profile);
        console.log(profileJSON);
        var reconstructedProfile = motionProfileFactory.deserialize(profileJSON);

        expect(reconstructedProfile.type).toBe("linear");
        expect(reconstructedProfile.evaluateVelocityAt(0)).toBeCloseTo(12.5, 4);
        expect(reconstructedProfile.evaluateVelocityAt(1.25)).toBeCloseTo(12.5, 4);
        expect(reconstructedProfile.evaluateVelocityAt(1)).toBeCloseTo(1.3820, 4);
        expect(reconstructedProfile.evaluateVelocityAt(1)).toBeCloseTo(1.3820, 4);
        // console.log(reconstructedProfile);
    });
});