describe('Unit: cruise/dwell segment testing', function() {
    var cruiseSegmentFactory = require('../lib/segments/cruiseDwellSegment');

    xit('should create an cruise dwell segment with via distance (t0=0,tf=0.5,p0=0,v0=50,pf=25) and correctly evalute position and velocities', function() {
        // Make(t0, tf, p0, v, pf, permutation, mode, loads){
        var seg = cruiseSegmentFactory.Make(0, 0.5, 0, 50, 25, 'time', 'incremental');

        expect(seg.evaluatePositionAt(0.25)).toBe(12.5);
        expect(seg.evaluateVelocityAt(0.25)).toBe(50);
        expect(seg.evaluatePositionAt(0.50)).toBe(25);
    });

    xit('should create an cruise dwell segment with via distance (t0=0,tf=2,p0=0,v0=0,pf=25) and correctly evalute position and velocities', function() {
        var seg = cruiseSegmentFactory.Make(0, 0.5, 0, 0, 0, 'time', 'incremental');

        expect(seg.evaluatePositionAt(0.25)).toBe(0);
        expect(seg.evaluateVelocityAt(0.25)).toBe(0);
        expect(seg.evaluatePositionAt(0.50)).toBe(0);
    });

    it('should create a cruise segment via zero distance and starting with v0=0 (t0=0,tf=2,p0=0,v0=0,pf=0', function() {
        var seg = cruiseSegmentFactory.Make(0, 0.5, 0, 0, 0, 'time', 'incremental');

        expect(seg.evaluatePositionAt(0.25)).toBe(0);
        expect(seg.evaluateVelocityAt(0.25)).toBe(0);
        expect(seg.evaluatePositionAt(0.50)).toBe(0);
    });


    it('should throw when creating a cruise segment via non-zero distance and starting with v0=0 (t0=0,tf=0.5,p0=0,v0=0,pf=5', function() {
        expect(function() {
            cruiseSegmentFactory.Make(
                0,
                0.5,
                0,
                0,
                5,
                'distance',
                'incremental'
            );
        }).toThrow(
            new Error("Unable to create a cruise/dwell segment with zero initial velocity and non zero distance")
        );
    });


    // should be able to serialize/deserialze
});