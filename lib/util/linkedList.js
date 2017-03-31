/**
 * Node of the linked list
 * @param {Ojbect} data data object
 */
var Node = function(data) {
	this.data = data;
	this.next = null;
	this.previous = null;
};


/**
 * Double linked list functionality
 * some code swiped from: https://code.tutsplus.com/articles/data-structures-with-javascript-singly-linked-list-and-doubly-linked-list--cms-23392
 */
var LinkedList = function() {
	this._length = 0;
	this.head = null;
	this.tail = null;
};
/**
 * Add a value at the end of the list
 * @param {Object} value value to add
 */
LinkedList.prototype.add = function(value) {
	var node = new Node(value);

	if (this._length) {
		this.tail.next = node;
		node.previous = this.tail;
		this.tail = node;
	} else {
		this.head = node;
		this.tail = node;
	}

	this._length++;

	return node;
};


LinkedList.prototype.clearAll = function() {
	this._length = 0;
	this.head = null;
	this.tail = null;
};


/**
 * Inserts into the list using an existing node
 * @param  {Node} existing existing Node
 * @param  {Object} data     new data to insert before existing node
 * @return {Node}          new node that was inserted
 */
LinkedList.prototype.insertAt = function(existing, data) {
	var node = new Node(data);
	var next = existing.next;
	var prev = existing.previous;

	node.next = existing;
	existing.previous = node;

	// if there is a previous node, wire it up
	if (prev) {
		prev.next = node;
		node.previous = prev;
	} else {
		// if there is not a previous node, we are inserting a new first node, thus 
		// head must be modified
		this.head = node;
	}


	this._length++;
	return node;

};


/**
 * Removes nodes specified by the parameter
 * @param  {Node} node Node to remove
 * @return {Node}      removed node
 */
LinkedList.prototype.removeNode = function(node) {
	if (!(node instanceof Node))
		throw new Error('removeNode: expecting a Node as parameter type');

	var next = node.next;
	var prev = node.previous;

	//this could be the last node
	if (next)
		next.previous = prev;
	else
		this.tail=next;

	//could be the first node
	if (prev)
		prev.next = next;
	else
		this.head = next;



	var nodeToRemove = node;
	node = null;

	this._length--;

	return nodeToRemove;

};


/**
 * Returns current length of the linked list
 */
LinkedList.prototype.length = function() {
	return this._length;
};


/**
 * Gets all nodes currently in the list
 * @returns {Array} array of all nodes in the list
 */
LinkedList.prototype.getAllNodes = function() {
	var result = [];

	var currentNode = this.head;

	while (currentNode) {
		result.push(currentNode);
		currentNode = currentNode.next;
	}


	return result;
};



/**
 * Gathers data from all nodes into an array
 * @returns {Array} array of all nodes in the list
 */
LinkedList.prototype.getDataArray = function() {
	var result = [];

	var currentNode = this.head;

	while (currentNode) {
		result.push(currentNode.data);
		currentNode = currentNode.next;
	}


	return result;
};



/**
 * Get node at the specified position
 * @param  {Number} position position to get node at
 * @return {Node}          Node at specified position
 */
LinkedList.prototype.searchNodeAt = function(position) {
	var currentNode = this.head,
		length = this._length,
		count = 1,
		message = {
			failure: 'Failure: non-existent node in this list.'
		};

	// 1st use-case: an invalid position
	if (length === 0 || position < 1 || position > length) {
		throw new Error(message.failure);
	}

	// 2nd use-case: a valid position
	while (count < position) {
		currentNode = currentNode.next;
		count++;
	}

	return currentNode;
};



/**
 * Removes node at specified position
 * @param  {Number} position node at this position will be deleted
 * @return {Object}          Deleted node
 */
LinkedList.prototype.remove = function(position) {
	var currentNode = this.head,
		length = this._length,
		count = 1,
		message = {
			failure: 'Failure: non-existent node in this list.'
		},
		beforeNodeToDelete = null,
		nodeToDelete = null,
		deletedNode = null;

	// 1st use-case: an invalid position
	if (length === 0 || position < 1 || position > length) {
		throw new Error(message.failure);
	}

	// 2nd use-case: the first node is removed
	if (position === 1) {
		this.head = currentNode.next;
		deletedNode = currentNode;

		// 2nd use-case: there is a second node
		if (!this.head) {
			this.head.previous = null;
			// 2nd use-case: there is no second node
		} else {
			this.tail = null;
		}

		this._length--;

		return deletedNode;

	}

	// 3rd use-case: the last node is removed
	if (position === this._length) {
		deletedNode = this.tail;
		this.tail = this.tail.previous;
		this.tail.next = null;

		this._length--;
		return deletedNode;

	}

	// 4th use-case: a middle node is removed

	while (count < position) {
		currentNode = currentNode.next;
		count++;
	}

	beforeNodeToDelete = currentNode.previous;
	nodeToDelete = currentNode;
	var afterNodeToDelete = currentNode.next;

	beforeNodeToDelete.next = afterNodeToDelete;
	afterNodeToDelete.previous = beforeNodeToDelete;
	deletedNode = nodeToDelete;
	nodeToDelete = null;


	this._length--;

	return deletedNode;
};


var factory = {};

/**
 * Creates a new linked list
 */
factory.makeLinkedList = function() {
	return new LinkedList();
};


module.exports = factory;