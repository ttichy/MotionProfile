var fastMath = require('../lib/util/fastMath');

var customMatchers = {
    toBeWithinEpsilon: function(util, customEqualityTesters) {
        return {
            compare: function(actual,expected) {
                var result={};

                result.pass=fastMath.equal(actual,expected);

                if(result.pass)
                    result.message = "PASSED";
                else
                    result.message = "Expected "+actual+" to be within EPSILON of "+expected;

                return result;
            }
        };
    }
};

describe('Unit: motionProfileFactory testing', function() {
    var motionProfileFactory = require('../lib/profile/motionProfile');

    // setInitialConditions
    it('should create a profile with segments, try to set the start conditions to bad values, catch it, and still evaluate everything correctly.', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        profile.setInitialConditions(0, 1, 0, 0, 0); // set init vel to 1 m/s

        var seg1 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: 0,
                tf: 2,
                p0: 0,
                pf: 5,
                v: 0,
                velLimPos: null,
                velLimNeg: null,
                accJerk: 1,
                decJerk: 1,
                xSkew: null,
                ySkew: null,
                shape: 'triangle',
                mode: 'absolute'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createCruiseDwellSegment({
                t0: 0,
                tf: 0.5,
                p0: 0,
                v0: 1,
                pf: 0.5,
                permutation: 'distance',
                mode: 'incremental'
            })
        );

        expect(profile.evaluateAccelerationAt(0.5)).toBeCloseTo(6);
        expect(profile.evaluateVelocityAt(0.5)).toBeCloseTo(2.5);
        expect(profile.evaluatePositionAt(0.5)).toBeCloseTo(0.75);

        expect(profile.evaluateAccelerationAt(2.2)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.2)).toBeCloseTo(1);
        expect(profile.evaluatePositionAt(2.2)).toBeCloseTo(5.2);

        expect(function () {
            profile.setInitialConditions(0, 0, 0, 0, 0);
        }).toThrowError('Unable to modify initial conditions as it would invalidate a segment.');

        expect(profile.evaluateAccelerationAt(0.5)).toBeCloseTo(6);
        expect(profile.evaluateVelocityAt(0.5)).toBeCloseTo(2.5);
        expect(profile.evaluatePositionAt(0.5)).toBeCloseTo(0.75);

        expect(profile.evaluateAccelerationAt(2.2)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.2)).toBeCloseTo(1);
        expect(profile.evaluatePositionAt(2.2)).toBeCloseTo(5.2);
    });

    // cutSegment
    it('should create a profile with an acceleration to a non-zero velocity, then a distance-based cruise/dwell, then throw an error when the accel segment is cut, and still evaluate correctly', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 2,
                p0: 0,
                v0: 0,
                vf: 5,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createCruiseDwellSegment({
                t0: 0,
                tf: 0.1,
                p0: 0,
                v0: 5,
                pf: 0.5,
                permutation: 'distance',
                mode: 'incremental'
            })
        );

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);

        expect(function () {
            profile.cutSegment(seg1.id);
        }).toThrowError('Attempt to cut segment failed downstream with error: Error: Cannot modify cruise/dwell segment because of non-zero distance and zero velocity');

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);
    });

    // paste segment that violates zero velocity for distance permutation cruise/dwell
    it('Pasting an accel segment that invalidates a cruise/dwell', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 2,
                p0: 0,
                v0: 0,
                vf: 5,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createCruiseDwellSegment({
                t0: 0,
                tf: 0.1,
                p0: 0,
                v0: 5,
                pf: 0.5,
                permutation: 'distance',
                mode: 'incremental'
            })
        );

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);

        var seg3 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 7.5,
                p0: seg2.segmentData.finalPosition,
                v0: 5,
                vf: 0,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        profile.cutSegment(seg3.id);
        expect(function () {
            profile.pasteSegment(seg2.id);
        }).toThrowError('Pasting segment failed with Error: Cannot modify cruise/dwell segment because of non-zero distance and zero velocity');

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);
    });

    // paste segment that violates absolute time constraint
    it('should try to paste a segment that violates an absolute timee constraint', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 2,
                p0: 0,
                v0: 0,
                vf: 5,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createCruiseDwellSegment({
                t0: 0,
                tf: 2.1,
                p0: seg1.segmentData.initialPosition,
                v0: 5,
                pf: 7.5,
                permutation: 'distance',
                mode: 'absolute'
            })
        );

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);

        var seg3 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 4,
                p0: seg2.segmentData.finalPosition,
                v0: 5,
                vf: 3,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        profile.cutSegment(seg3.id);
        expect(function () {
            profile.pasteSegment(seg2.id);
        }).toThrowError('Pasting segment failed with Error: Cannot have permutation distance and time <= 0');

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);
    });

    // insert segment that causes absolute error
    it('should try to insert a segment that violates an absolute timee constraint', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 2,
                p0: 0,
                v0: 0,
                vf: 5,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createCruiseDwellSegment({
                t0: 0,
                tf: 2.1,
                p0: seg1.segmentData.initialPosition,
                v0: 5,
                pf: 7.5,
                permutation: 'distance',
                mode: 'absolute'
            })
        );

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);

        var seg3 = motionProfileFactory.createAccelSegment('time-velocity', {
            t0: 0,
            tf: 4,
            p0: seg2.segmentData.finalPosition,
            v0: 5,
            vf: 3,
            jPct: 0.4,
            mode: 'incremental'
        });

        expect(function () {
            profile.insertSegment(seg3, seg2.id);
        }).toThrowError('Inserting segment failed with Error: Cannot have permutation distance and time <= 0');

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);
    });

    // modify segment values t0 0 velocity
    it('should try to modify a segment that violates non-zero velocity on cruise/dwell segment', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 2,
                p0: 0,
                v0: 0,
                vf: 5,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createCruiseDwellSegment({
                t0: 0,
                tf: 2.1,
                p0: seg1.segmentData.initialPosition,
                v0: 5,
                pf: 7.5,
                permutation: 'distance',
                mode: 'absolute'
            })
        );

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 4);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 4);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 4);

        expect(function () {
            profile.modifySegmentValues(seg1.id, {speed: 0});
        }).toThrowError('Modifying segment failed with Error: Cannot modify cruise/dwell segment because of non-zero distance and zero velocity');

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(2.06)).toBeCloseTo(0, 8);
        expect(profile.evaluateVelocityAt(2.06)).toBeCloseTo(5, 8);
        expect(profile.evaluatePositionAt(2.06)).toBeCloseTo(5.3, 8);
    });

    // modify violates absolute
    it('should try to modify a segment that violates absolute time', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-velocity', {
                t0: 0,
                tf: 2,
                p0: 0,
                v0: 0,
                vf: 5,
                jPct: 0.4,
                mode: 'incremental'
            })
        );

        var seg2 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: 0,
                tf: 4,
                p0: 0,
                pf: 5,
                v: 0,
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.1,
                decJerk: 0,
                xSkew: null,
                ySkew: null,
                shape: 'triangle',
                mode: 'absolute'
            })
        );

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(3.1)).toBeCloseTo(10, 4);
        expect(profile.evaluateVelocityAt(3.1)).toBeCloseTo(-4, 8);
        expect(profile.evaluatePositionAt(3.1)).toBeCloseTo(4.55, 8);

        expect(function () {
            profile.modifySegmentValues(seg1.id, {duration: 10});
        }).toThrowError('Modifying segment failed with Error: Attempt to move initial time past absolute final time');

        expect(profile.evaluateAccelerationAt(1.8)).toBeCloseTo(1.5625, 4);
        expect(profile.evaluateVelocityAt(1.8)).toBeCloseTo(4.8438, 4);
        expect(profile.evaluatePositionAt(1.8)).toBeCloseTo(4.01041667);

        expect(profile.evaluateAccelerationAt(3.1)).toBeCloseTo(10, 4);
        expect(profile.evaluateVelocityAt(3.1)).toBeCloseTo(-4, 8);
        expect(profile.evaluatePositionAt(3.1)).toBeCloseTo(4.55, 8);
    });

    it('should fail to change an index segemnt velocity limits', function () {
        var profile = motionProfileFactory.createMotionProfile("linear");

        var seg2 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: 0,
                tf: 1,
                p0: 0,
                pf: 1,
                v: 0,
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.1,
                decJerk: 0,
                xSkew: null,
                ySkew: null,
                shape: 'triangle',
                mode: 'absolute'
            })
        );

        expect(function () {
            profile.modifySegmentValues(seg2.id, {velLimPos: 0, velLimNeg: 0, accJerk: 0.38});
        }).toThrowError('Modifying segment failed with Error: Positive velocity limit too low');

    });
});
