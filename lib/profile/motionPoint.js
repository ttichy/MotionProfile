var Util = require('../util/util');

exports.MotionPoint = function (t, j, a, v, p, l, th, f) {

	if(Util.isUndefined(t) || Util.isUndefined(j) || Util.isUndefined(a) || Util.isUndefined(v) || Util.isUndefined(p))
		throw new Error("MotionPoint expects time, jerk, accel, velocity and position to be defined");

	this.time = t;
	this.jerk = j;
	this.position = p;
	this.velocity = v;
	this.acceleration = a;

	this.load = l || 0; //inertia or mass
	this.thrust = th || 0; //force or torque
	this.friction = f || 0; //friction coeff or friction
};