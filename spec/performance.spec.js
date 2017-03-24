xdescribe('Unit: motionProfileFactory performance testing', function() {

    var motionProfileFactory = require('../lib/profile/motionProfile');
    var accelSegmentFactory = require('../lib/segments/accelSegment');
    var fastMath = require('../lib/util/fastMath');
    var ph = require('../lib/profile/profileHelper');


    var TOTAL = 20000;

    it('timing ' + TOTAL + '  profile operations', function() {



        var profile = motionProfileFactory.createMotionProfile("rotary");

        var initTime = new Date();

        for (var i = 0; i < TOTAL; i++) {

            var seg1 = motionProfileFactory.createAccelSegment("time-velocity", {
                t0: i,
                tf: i + 1,
                p0: 0,
                v0: 0,
                vf: 5 + i,
                jPct: 0.5,
                mode: "incremental"

            });

            profile.appendSegment(seg1);

        }

        var insertDone = new Date();

        var insertSeconds = (insertDone - initTime) / 1000;


        var allSegs = profile.getAllSegments();
        var getAllTime = new Date();

        var getAllSeconds = (getAllTime - insertDone) / 1000;

        var first = allSegs[0];

        profile.deleteSegment(first.id);

        var delDoneTime = new Date();

        var deleteSeconds = (delDoneTime - getAllTime) / 1000;


        console.log('Time to insert ' + TOTAL + ' segments ', insertSeconds);
        console.log('Time to get ' + TOTAL + ' segments', getAllSeconds);
        console.log('Time to delete the first segment (recalculate the rest) in ' + TOTAL + ' segments', deleteSeconds);



    });
});