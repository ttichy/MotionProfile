describe('Unit: indexSegmentFactory testing', function() {

    var indexSegmentFactory = require('../lib/segments/indexSegment');
    var MotionPoint = require('../lib/profile/motionPoint').MotionPoint;

    it('should create an index segment (t0=1, dt=1(tf=2), p0=0.25, dp=1 (pf = 1.25), v=0.5, velLimPos=null, velLimNeg=null, accJerkPct=0.4, decJerkPct=0.6, xSkew=-0.5, ySkew=0.3, shape=trapezoid, mode=incremental) and correctly evalute position and velocities', function() {

        var seg = indexSegmentFactory.Make(1, 2, 0.25, 1.25, 0.5, null, null, 0.4, 0.6, -0.5, 0.3, 'trapezoid', 'incremental');

        var allSegs = seg.getAllSegments();

        expect(allSegs.length).toBe(7);

        var seg1 = allSegs[0];
        var seg2 = allSegs[1];
        var seg3 = allSegs[2];
        var seg4 = allSegs[3];
        var seg5 = allSegs[4];
        var seg6 = allSegs[5];
        var seg7 = allSegs[6];

        expect(seg1.initialTime).toBe(1);
        expect(seg1.finalTime).toBeCloseTo(1.0230769, 4);
        expect(seg1.evaluatePositionAt(seg1.finalTime)).toBeCloseTo(0.2621635, 4);

        expect(seg2.evaluateVelocityAt(1.075739645)).toBeCloseTo(0.9520833, 4);

        expect(seg3.finalTime).toBeCloseTo(1.11539, 4);

        expect(seg4.evaluateVelocityAt(1.2)).toBe(1.15);
        expect(seg4.finalTime).toBeCloseTo(1.65385, 4);

        expect(seg5.finalTime).toBeCloseTo(1.7576923, 5);
        expect(seg5.evaluatePositionAt(1.7)).toBeCloseTo(1.017075, 4);

        expect(seg6.initialTime).toBeCloseTo(1.7576923, 5);
        expect(seg6.evaluateVelocityAt(1.84111)).toBeCloseTo(0.78694, 4);

        expect(seg7.evaluatePositionAt(1.96)).toBeCloseTo(1.2297215, 4);
        expect(seg7.finalTime).toBe(2);

    });

    it('should create an index segment (t0=0.2, tf=5, p0=0.05, pf=1, v=0.5, velLimPos=null, velLimNeg=null, accJerkPct=0.3, decJerkPct=0, xSkew=0.33, ySkew=0.95, shape=trapezoid, mode=absolute) and correctly evaluate positions and velocities', function() {

        var seg = indexSegmentFactory.Make(0.2, 5, 0.05, 1, 0.5, null, null, 0.3, 0, 0.33, 0.95, 'trapezoid', 'absolute');

        var allSegs = seg.getAllSegments();

        expect(allSegs.length).toBe(5);

        var seg1 = allSegs[0];
        var seg2 = allSegs[1];
        var seg3 = allSegs[2];
        var seg4 = allSegs[3];
        var seg5 = allSegs[4];

        expect(seg1.finalTime).toBeCloseTo(0.666523, 4);
        expect(seg1.evaluatePositionAt(0.5603828)).toBeCloseTo(0.2264539, 4);

        expect(seg2.evaluateVelocityAt(2.67719216)).toBeCloseTo(0, 4);

        expect(seg4.initialTime).toBeCloseTo(3.31015, 4);
        expect(seg4.finalTime).toBeCloseTo(3.433231, 4);

        expect(seg4.evaluateVelocityAt(seg4.finalTime)).toBeCloseTo(-0.0890625, 4);

    });

    it('should create an index segment, modify initial position and evaluate correctly', function() {

        var seg = indexSegmentFactory.Make(0.2, 5, 0.05, 1, 0.5, null, null, 0.3, 0, 0.33, 0.95, 'trapezoid', 'absolute');
        expect(seg.segmentData.duration).toBe(4.8);

        var newSeg = seg.modifyInitialValues(new MotionPoint(0,0, 0, -0.2, 0.3));

        var allSegs = seg.getAllSegments();

        expect(allSegs.length).toBe(5);

        var seg1 = allSegs[0];
        var seg2 = allSegs[1];
        var seg3 = allSegs[2];
        var seg4 = allSegs[3];
        var seg5 = allSegs[4];

        expect(seg1.finalTime).toBeCloseTo(0.485961, 4);
        expect(seg1.evaluatePositionAt(0.36)).toBeCloseTo(0.231860, 4);

        expect(seg2.evaluateVelocityAt(2.3002)).toBeCloseTo(0.29529, 4);

        expect(seg4.initialTime).toBeCloseTo(3.23974, 4);
        expect(seg4.finalTime).toBeCloseTo(3.36794872, 4);

        expect(seg4.evaluateVelocityAt(seg4.finalTime)).toBeCloseTo(0.463, 4);
    });

});