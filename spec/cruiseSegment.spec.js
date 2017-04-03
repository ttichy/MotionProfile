describe('Unit: cruise/dwell segment testing', function() {

    var accelSegmentFactory = require('../lib/segments/accelSegment');
    var cruiseSegmentFactory = require('../lib/segments/cruiseDwellSegment');



    it('should create an cruise dwell segment with via distance (t0=0,tf=2,p0=0,v0=50) and correctly evalute position and velocities', function() {

        var seg = cruiseSegmentFactory.makeWithDistance(0,0.5,0,50,25,'incremental');
    });


});