MotionProfile
=============

service to build motion profile data representation

motionanalyzer.rockwellautomation.com


## Tests
karma start .\karma.conf.js


## Bundle
To create a bundle that can be consumed by browser-based JS applications, the following two steps must be completed in order after `npm install`: 
#### Edit Undo Manager
At the end of `node_modules/undo-manager/lib/undomanager.js`, you'll find the following code:

```
if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
		// AMD. Register as an anonymous module.
		define(function() {
			return UndoManager;
		});
	} else if (typeof module !== 'undefined' && module.exports) {
		module.exports = UndoManager;
	} else {
		window.UndoManager = UndoManager;
	}
```

This code ensures that the module is loaded in the proper manner if present (Asynchronous Module Definition, CommonJS, or a global object). However if a project using requirejs imports the bundled Motion Profile module, Undo Manager will default to AMD and give the bundle problems loading it. This is why we need to change the above code to the following:
 
```
if (typeof module !== 'undefined' && module.exports) {
		module.exports = UndoManager;
	} else if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
		// AMD. Register as an anonymous module.
		define(function() {
			return UndoManager;
		});
	} else {
		window.UndoManager = UndoManager;
	}
```

After this change, Undo Manager will favor CommonJS (necessary for bundling with Browserify) over AMD when both are present.

#### Create the bundle
Once the described changes have been made, simply use `npm run build`, which will output `MotionProfile.js`. 

## Release history
* 1.0.0 Inital port from the angular oriented Profilr