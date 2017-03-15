describe('Unit: accelSegmentFactory testing', function() {

    var accelSegmentFactory = require('../lib/segments/accelSegment');



    it('should create an accel segment (t0=0,tf=2,p0=0,v0=0,vf=10,j=0.5) and correctly evalute position and velocities', function() {

        var seg = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        expect(seg.getAllSegments().length).toBe(3);

        var seg1 = seg.getAllSegments()[0];
        var seg2 = seg.getAllSegments()[1];
        var seg3 = seg.getAllSegments()[2];



        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(0.5);
        expect(seg1.evaluatePositionAt(0)).toBe(0);
        expect(seg1.evaluatePositionAt(0.5)).toBeCloseTo(0.2777777, 4);

        expect(seg2.initialTime).toBe(0.5);
        expect(seg2.finalTime).toBe(1.5);
        expect(seg2.evaluatePositionAt(0.5)).toBeCloseTo(0.2777777, 4);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(5.2777777777777, 4);


        expect(seg3.initialTime).toBe(1.5);
        expect(seg3.finalTime).toBe(2);
        expect(seg3.evaluatePositionAt(1.5)).toBeCloseTo(5.2777777777777, 4);
        expect(seg3.evaluatePositionAt(2)).toBe(10);

    });

    it('should create an accel segment (t0=2,tf=4,p0=10,v0=10,vf=0,j=0.5) and correctly evalute position and velocities', function() {

        var seg = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

        expect(seg.getAllSegments().length).toBe(3);

        var seg1 = seg.getAllSegments()[0];
        var seg2 = seg.getAllSegments()[1];
        var seg3 = seg.getAllSegments()[2];

        expect(seg1.initialTime).toBe(2);
        expect(seg1.finalTime).toBe(2.5);

        expect(seg1.evaluatePositionAt(2)).toBe(10);


        expect(seg2.initialTime).toBe(2.5);
        expect(seg2.finalTime).toBe(3.5);


        expect(seg3.initialTime).toBe(3.5);
        expect(seg3.finalTime).toBe(4);
        expect(seg3.evaluatePositionAt(4)).toBe(20);
        expect(seg3.evaluateVelocityAt(4)).toBeCloseTo(0, 5);

    });

    it('should create an accel segment (t0=0,tf=2,p0=0,v0=0,vf=10,j=0.5), modify initial position and evaluate correctly', function() {

        var seg = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

        var newSeg = seg.modifyInitialValues(0, 0, 0, 1);


        var seg1 = newSeg.getAllSegments()[0];
        var seg2 = newSeg.getAllSegments()[1];
        var seg3 = newSeg.getAllSegments()[2];


        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(0.5);
        expect(seg1.evaluatePositionAt(0)).toBe(1);
        expect(seg1.evaluatePositionAt(0.5)).toBeCloseTo(1.2777777, 4);

        expect(seg2.initialTime).toBe(0.5);
        expect(seg2.finalTime).toBe(1.5);
        expect(seg2.evaluatePositionAt(0.5)).toBeCloseTo(1.2777777, 4);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(6.2777777777777, 4);


        expect(seg3.initialTime).toBe(1.5);
        expect(seg3.finalTime).toBe(2);
        expect(seg3.evaluatePositionAt(1.5)).toBeCloseTo(6.2777777777777, 4);
        expect(seg3.evaluatePositionAt(2)).toBe(11);

    });

    it('should create an time-velocity accel segment (t0=0,tf=2,p0=0,v0=0,vf=10,j=0.5), modify initial velocity and evaluate correctly', function() {

        // (t0, tf, p0, v0, vf, jPct, mode, loads)
        var seg = accelSegmentFactory.MakeFromTimeVelocity(
            0, // t0
            2, // tf
            0, // p0
            0, // v0
            10, // vf
            0.5); // jPct

        // t, a, v, p
        seg.modifyInitialValues(0, 0, 1, 0);

        var seg1 = seg.getAllSegments()[0];
        var seg2 = seg.getAllSegments()[1];
        var seg3 = seg.getAllSegments()[2];

        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(0.5);
        expect(seg1.evaluatePositionAt(0)).toBe(0);
        expect(seg1.evaluatePositionAt(0.5)).toBeCloseTo(0.777777, 4);

        expect(seg2.initialTime).toBe(0.5);
        expect(seg2.finalTime).toBe(1.5);
        expect(seg2.evaluatePositionAt(0.5)).toBeCloseTo(0.77777, 4);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(6.77777, 4);

        expect(seg3.initialTime).toBe(1.5);
        expect(seg3.finalTime).toBe(2);
        expect(seg3.evaluatePositionAt(1.5)).toBeCloseTo(6.777777, 4);
        expect(seg3.evaluatePositionAt(2)).toBe(12);

    });

    it('should create an incremental time-velocity accel segment (t0=0,tf=2,p0=0,v0=0,vf=10,j=0.5), modify initial position AND velocity and evaluate correctly', function() {

        var seg = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5, "incremental");

        seg.modifyInitialValues(0, 0, 1, 1);

        var seg1 = seg.getAllSegments()[0];
        var seg2 = seg.getAllSegments()[1];
        var seg3 = seg.getAllSegments()[2];

        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(0.5);
        expect(seg1.evaluatePositionAt(0)).toBe(1);
        expect(seg1.evaluatePositionAt(0.5)).toBeCloseTo(1.77777, 4);

        expect(seg2.initialTime).toBe(0.5);
        expect(seg2.finalTime).toBe(1.5);
        expect(seg2.evaluatePositionAt(0.5)).toBeCloseTo(1.777777, 4);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(7.777777, 4);


        expect(seg3.initialTime).toBe(1.5);
        expect(seg3.finalTime).toBe(2);
        expect(seg3.evaluatePositionAt(1.5)).toBeCloseTo(7.777777, 4);
        expect(seg3.evaluatePositionAt(2)).toBe(13);
    });

    it('should create an absolute time-velocity accel segment (t0=2,tf=4,p0=6,v0=5,pf=10,j=0), modify initial time, position AND velocity and evaluate correctly', function() {


        //t0, tf, p0, v0, pf, jPct
        var seg = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 6, 6, -1, 0.5, "absolute");

        //quick check the segment
        var segs = seg.getAllSegments();
        expect(segs.length).toBe(3);

        var seg2 = segs[1];
        var seg3 = seg[2];

        expect(seg2.evaluatePositionAt(3)).toBeCloseTo(10.6388888888, 6);
        expect(seg2.evaluatePositionAt(3.5)).toBeCloseTo(11.305555555555, 5);


        var t0 = 1,
            a0 = 0,
            v0 = 12,
            p0 = 6;

        seg.modifyInitialValues(t0, a0, v0, p0);

        segs = seg.getAllSegments();

        var seg1 = segs[0];
        seg2 = segs[1];
        seg3 = segs[2];


        expect(seg1.initialTime).toBe(1);
        expect(seg1.finalTime).toBe(1.75);
        expect(seg1.evaluatePositionAt(1)).toBe(6);
        expect(seg1.evaluatePositionAt(1.75)).toBeCloseTo(14.4583333333, 4);

        expect(seg2.initialTime).toBe(1.75);
        expect(seg2.finalTime).toBe(3.25);
        expect(seg2.evaluatePositionAt(1.75)).toBeCloseTo(14.45833333332, 4);
        expect(seg2.evaluatePositionAt(3.25)).toBeCloseTo(22.708333333, 4);


        expect(seg3.initialTime).toBe(3.25);
        expect(seg3.finalTime).toBe(4);
        expect(seg3.evaluatePositionAt(3.25)).toBeCloseTo(22.70833333322, 4);
        expect(seg3.evaluateVelocityAt(3.25)).toBeCloseTo(1.16666666666, 6);

        expect(seg3.evaluatePositionAt(4)).toBeCloseTo(22.5, 6);
        expect(seg3.evaluateVelocityAt(4)).toBeCloseTo(-1, 6);

    });



    it('should create a time-distance accel segment (t0=0,tf=2,p0=0,v0=0,pf=10,j=0.5), and evaluate correctly', function() {

        var seg = accelSegmentFactory.MakeFromTimeDistance(0, 2, 0, 0, 10, 0.5);

        var segs = seg.getAllSegments();
        expect(segs.length).toBe(3);

        var seg1 = segs[0];
        var seg2 = segs[1];
        var seg3 = segs[2];

        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(0.5);
        expect(seg1.evaluatePositionAt(0)).toBe(0);
        expect(seg1.evaluatePositionAt(0.5)).toBeCloseTo(0.27777, 4);

        expect(seg2.initialTime).toBe(0.5);
        expect(seg2.finalTime).toBe(1.5);
        expect(seg2.evaluatePositionAt(0.5)).toBeCloseTo(0.277777, 4);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(5.2777777, 4);


        expect(seg3.initialTime).toBe(1.5);
        expect(seg3.finalTime).toBe(2);
        expect(seg3.evaluatePositionAt(1.5)).toBeCloseTo(5.2777777, 4);
        expect(seg3.evaluatePositionAt(2)).toBe(10);



    });

    it('should create a time-distance accel segment (t0=0,tf=2,p0=0,v0=0,pf=10,j=0.5), modify initial position AND velocity and evaluate correctly', function() {



        var seg = accelSegmentFactory.MakeFromTimeDistance(0, 2, 0, 0, 10, 0.5);

        var t0 = 0,
            a0 = 0,
            v0 = 1,
            p0 = 1;

        seg.modifyInitialValues(t0, a0, v0, p0);


        var seg1 = seg.getAllSegments()[0];
        var seg2 = seg.getAllSegments()[1];
        var seg3 = seg.getAllSegments()[2];


        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(0.5);
        expect(seg1.evaluatePositionAt(0)).toBe(1);
        expect(seg1.evaluatePositionAt(0.5)).toBeCloseTo(1.722222, 4);

        expect(seg2.initialTime).toBe(0.5);
        expect(seg2.finalTime).toBe(1.5);
        expect(seg2.evaluatePositionAt(0.5)).toBeCloseTo(1.722222, 4);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(6.722222, 4);


        expect(seg3.initialTime).toBe(1.5);
        expect(seg3.finalTime).toBe(2);
        expect(seg3.evaluatePositionAt(1.5)).toBeCloseTo(6.722222, 4);
        expect(seg3.evaluatePositionAt(2)).toBe(11);

    });



    it('should create an incremental time-distance accel segment (t0=2,tf=4,p0=6,v0=5,pf=10,j=0), modify initial time, position AND velocity and evaluate correctly', function() {


        //t0, tf, p0, v0, pf, jPct
        var seg = accelSegmentFactory.MakeFromTimeDistance(2, 4, 6, 6, 11, 0.5, "incremental");

        //quick check the segment
        var segs = seg.getAllSegments();
        expect(segs.length).toBe(3);

        var seg2 = segs[1];
        var seg3 = seg[2];

        expect(seg2.evaluatePositionAt(3)).toBeCloseTo(10.6388888888, 6);
        expect(seg2.evaluatePositionAt(3.5)).toBeCloseTo(11.305555555555, 5);


        var t0 = 1,
            a0 = 0,
            v0 = 12,
            p0 = 6;

        seg.modifyInitialValues(t0, a0, v0, p0);

        segs = seg.getAllSegments();

        var seg1 = segs[0];
        seg2 = segs[1];
        seg3 = segs[2];


        expect(seg1.initialTime).toBe(1);
        expect(seg1.finalTime).toBe(1.5);
        expect(seg1.evaluatePositionAt(1)).toBe(6);
        expect(seg1.evaluatePositionAt(1.5)).toBeCloseTo(11.47222222, 4);

        expect(seg2.initialTime).toBe(1.5);
        expect(seg2.finalTime).toBe(2.5);
        expect(seg2.evaluatePositionAt(1.5)).toBeCloseTo(11.4722222, 4);
        expect(seg2.evaluatePositionAt(2.5)).toBeCloseTo(13.9722222, 4);


        expect(seg3.initialTime).toBe(2.5);
        expect(seg3.finalTime).toBe(3);
        expect(seg3.evaluatePositionAt(2.5)).toBeCloseTo(13.9722222, 4);
        expect(seg3.evaluatePositionAt(3)).toBe(11);

    });


    it('should create an absolute time-distance accel segment (t0=2,tf=4,p0=6,v0=5,pf=10,j=0), modify initial time, position AND velocity and evaluate correctly', function() {


        //t0, tf, p0, v0, pf, jPct
        var seg = accelSegmentFactory.MakeFromTimeDistance(2, 4, 6, 6, 11, 0.5, "absolute");

        //quick check the segment
        var segs = seg.getAllSegments();
        expect(segs.length).toBe(3);

        var seg2 = segs[1];
        var seg3 = seg[2];

        expect(seg2.evaluatePositionAt(3)).toBeCloseTo(10.6388888888, 6);
        expect(seg2.evaluatePositionAt(3.5)).toBeCloseTo(11.305555555555, 5);


        var t0 = 1,
            a0 = 0,
            v0 = 12,
            p0 = 6;

        seg.modifyInitialValues(t0, a0, v0, p0);

        segs = seg.getAllSegments();

        var seg1 = segs[0];
        seg2 = segs[1];
        seg3 = segs[2];


        expect(seg1.initialTime).toBe(1);
        expect(seg1.finalTime).toBe(1.75);
        expect(seg1.evaluatePositionAt(1)).toBe(6);
        expect(seg1.evaluatePositionAt(1.75)).toBeCloseTo(14.1388888888888, 4);

        expect(seg2.initialTime).toBe(1.75);
        expect(seg2.finalTime).toBe(3.25);
        expect(seg2.evaluatePositionAt(1.75)).toBeCloseTo(14.1388888888888, 4);
        expect(seg2.evaluatePositionAt(3.25)).toBeCloseTo(16.638888888888886, 4);


        expect(seg3.initialTime).toBe(3.25);
        expect(seg3.finalTime).toBe(4);
        expect(seg3.evaluatePositionAt(3.25)).toBeCloseTo(16.6388888888888862, 4);
        expect(seg3.evaluatePositionAt(4)).toBeCloseTo(11, 5);

    });

    it('should create a time-distance accel segment with non-zero start time (t0=2,tf=4,p0=6,v0=2,pf=11,j=0.5) and evaluate correctly', function() {


        //t0, tf, p0, v0, pf, jPct
        var seg = accelSegmentFactory.MakeFromTimeDistance(2, 4, 6, 2, 11, 0.5);

        //quick check the segment
        var segs = seg.getAllSegments();
        expect(segs.length).toBe(3);

        var seg1 = segs[0];
        var seg2 = segs[1];
        var seg3 = segs[3];


        expect(seg1.evaluatePositionAt(2.5)).toBeCloseTo(7.027777777777778, 7);
        expect(seg1.evaluatePositionAt(2)).toBe(6);
    });



    it("Should correctly define an accel segment, 0 jerk with the time-distance permutation", function() {

        var seg = accelSegmentFactory.MakeFromTimeDistance(0, 1, 0, 0, 0.5, 0);
        var allSegs = seg.getAllSegments();

        expect(allSegs.length).toBe(1);

        var seg1 = allSegs[0];

        expect(seg1.initialTime).toBe(0);
        expect(seg1.finalTime).toBe(1);
        expect(seg1.evaluatePositionAt(0.5)).toBe(0.125);
        expect(seg1.evaluatePositionAt(1)).toBe(0.5);

        expect(seg1.evaluateVelocityAt(0.5)).toBe(0.5);
        expect(seg1.evaluateVelocityAt(1)).toBe(1);


    });

    it("Should correctly serialize and deserialize an accel segment", function() {

        //note this only works with initial conditions equal to zero.
        //once

        var seg = accelSegmentFactory.MakeFromTimeDistance(0, 1, 0, 0, 0.5, 0);

        var obj = seg.exportData();

        expect(obj.finalTime).toBe(1);
        expect(obj.mode).toEqual("incremental");
        expect(obj.finalPosition).toBe(0.5);


        var newSeg = seg.importFromData(obj);
        expect(seg.EvaluatePositionAt(0.56)).toBeCloseTo(newSeg.EvaluatePositionAt(0.56), 4);

    });

});