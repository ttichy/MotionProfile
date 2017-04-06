describe('Unit: cuty, copy, and paste testing', function() {
    var motionProfileFactory = require('../lib/profile/motionProfile');
    var FastMath = require('../lib/util/fastMath');

    it('should cut and paste a segment with working undo/redo', function () {
        var profile = motionProfileFactory.createMotionProfile('linear');

        profile.setInitialConditions(0,6,0,0,0);

        var indexSeg = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                //(t0, tf, p0, pf, v, velLimPos, velLimNeg, accJerk, decJerk, xSkew, ySkew, shape, mode) {
                t0: 0,
                tf: 5.65,
                p0: 0,
                pf: 12,
                v: profile.initialVelocity,
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

        var accelSeg = profile.appendSegment(
            motionProfileFactory.createAccelSegment('time-distance', {
                t0: indexSeg.segmentData.finalTime, // 5.65
                tf: 10,
                p0: indexSeg.segmentData.finalPosition,
                v0: indexSeg.segmentData.finalVelocity,
                pf: -2,
                jPct: 1,
                mode: 'absolute'
            })
        );

        // some general check stuff
        expect(indexSeg.initialTime).toBe(0);
        expect(accelSeg.initialTime).toBe(5.65);
        expect(profile.evaluateAccelerationAt(1)).toBeCloseTo(-3.43018247, 4);
        expect(profile.evaluateVelocityAt(8)).toBeCloseTo(-4.6421322, 4);

        // here we cut the accsel segment out of the profile
        profile.cutSegment(accelSeg.id);
        expect(profile.clipboard.id).toBe(accelSeg.id);
        expect(profile.getAllBasicSegments().length).toBe(7);

        // undoing the cut should clear the clipboard and return the accel segment to where it was.
        profile.undo();
        expect(indexSeg.initialTime).toBe(0);
        expect(accelSeg.initialTime).toBe(5.65);
        expect(profile.evaluateAccelerationAt(1)).toBeCloseTo(-3.43018247, 4);
        expect(profile.evaluateVelocityAt(8)).toBeCloseTo(-4.6421322, 4);
        expect(profile.clipboard).toBe(null);
        expect(profile.getAllBasicSegments().length).toBe(9);

        // redoing the cut should remove accel segment
        profile.redo();
        expect(profile.clipboard.id).toBe(accelSeg.id);
        expect(profile.getAllBasicSegments().length).toBe(7);

        // pasting the accel segment before the index segment..
        // we expect the index segment to start at end of absolute accel segment
        profile.pasteSegment(indexSeg.id);
        expect(profile.getAllBasicSegments().length).toBe(9);
        expect(indexSeg.initialTime).toBe(10);
        expect(profile.evaluateAccelerationAt(1)).toBeCloseTo(-0.496, 4);
        expect(accelSeg.evaluateVelocityAt(accelSeg.initialTime)).toBe(6);
        expect(accelSeg.evaluateVelocityAt(accelSeg.finalTime)).toBe(-6.4);
        expect(profile.evaluateVelocityAt(8)).toBeCloseTo(-5.40800000, 4);

        // trying to paste again should fail since it was an absolute segment
        expect(function() {
            profile.pasteSegment(indexSeg.id);
        }).toThrow(
            new Error("final time must be greater than initial time")
        );
        expect(profile.getAllBasicSegments().length).toBe(9);
        expect(indexSeg.initialTime).toBe(10);
        expect(profile.evaluateAccelerationAt(1)).toBeCloseTo(-0.496, 4);
        expect(accelSeg.evaluateVelocityAt(accelSeg.initialTime)).toBe(6);
        expect(accelSeg.evaluateVelocityAt(accelSeg.finalTime)).toBe(-6.4);
        expect(profile.evaluateVelocityAt(8)).toBeCloseTo(-5.408000, 4);

        // the first undo should remove the accel segment
        profile.undo();
        expect(profile.getAllBasicSegments().length).toBe(7);
        expect(profile.getAllSegments().length).toBe(1);
        // the cut accel seg should be on the clipboard
        expect(profile.clipboard.id).toBe(accelSeg.id);

        // this should undo the cut and reset the profile back to its original state
        profile.undo();
        expect(profile.clipboard).toBe(null);
        expect(indexSeg.initialTime).toBe(0);
        expect(accelSeg.initialTime).toBe(5.65);
        expect(profile.evaluateAccelerationAt(1)).toBeCloseTo(-3.43018247, 4);
        expect(profile.evaluateVelocityAt(8)).toBeCloseTo(-4.6421322, 4);

        // redo should redo the cut
        profile.redo();
        expect(profile.clipboard.id).toBe(accelSeg.id);
        expect(profile.getAllBasicSegments().length).toBe(7);

        // should redo the paste
        profile.redo();
        expect(profile.getAllBasicSegments().length).toBe(9);
        expect(indexSeg.initialTime).toBe(10);
        expect(profile.evaluateAccelerationAt(1)).toBeCloseTo(-0.496, 4);
        expect(accelSeg.evaluateVelocityAt(accelSeg.initialTime)).toBe(6);
        expect(accelSeg.evaluateVelocityAt(accelSeg.finalTime)).toBe(-6.4);
        expect(profile.evaluateVelocityAt(8)).toBeCloseTo(-5.40800000, 4);

        profile.copySegment(indexSeg.id);
        profile.pasteSegment(indexSeg.id);
        expect(profile.getAllSegments().length).toBe(3);
        expect(profile.evaluatePositionAt(18)).toBeCloseTo(12.96672, 4);
        expect(profile.getAllSegments()[2].id).toBe(indexSeg.id);
    });
});