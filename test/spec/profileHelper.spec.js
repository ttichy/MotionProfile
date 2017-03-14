describe('Unit: profile helper functions-', function() {
  var polynomialFactory = require('../../lib/util/polynomial');
  var basicSegmentFactory = require('../../lib/segments/basicSegment');
  var accelSegmentFactory = require('../../lib/segments/accelSegment');
  var ph = require('../../lib/segments/profileHelper');
  var motionProfileFactory = require('../../lib/profile/motionProfile');



  it('profile helper should validate basic segments in a valid profile', function() {
    var profile = motionProfileFactory.createMotionProfile("rotary");

    var accelSegment = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

    profile.appendSegment(accelSegment);

    accelSegment = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

    profile.appendSegment(accelSegment);

    ph.validateBasicSegments(profile.getAllBasicSegments());


  });



});