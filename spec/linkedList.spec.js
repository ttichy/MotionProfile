var linkedList = require('../lib/util/linkedList');

describe("Linked list unit tests", function() {
  it("Should add 2 nodes successfully", function() {

    var list = linkedList.makeLinkedList();
    expect(list).not.toBe(null);

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data1p5 = {
      "data1.5": 1.5
    };

    list.add(data1);
    expect(list.length()).toBe(1);
    expect(list.searchNodeAt(1).data).toBe(data1);

    list.add(data2);
    expect(list.length()).toBe(2);
    expect(list.searchNodeAt(2).data).toBe(data2);


  });

  it("Should add a node in front of the first node successfully", function() {

    var list = linkedList.makeLinkedList();
    expect(list).not.toBe(null);

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data1p5 = {
      "data1.5": 1.5
    };

    var node = list.add(data1);

    list.insertAt(node, data1p5);

    expect(list.length()).toBe(2);
    expect(list.searchNodeAt(1).data).toBe(data1p5);
    expect(list.searchNodeAt(2).data).toBe(data1);


  });


  it("Should add 2 nodes and insert 3rd in the middle", function() {

    var list = linkedList.makeLinkedList();
    expect(list).not.toBe(null);

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data1p5 = {
      "data1.5": 1.5
    };

    list.add(data1);
    var node = list.add(data2);

    list.insertAt(node, data1p5);

    expect(list.length()).toBe(3);
    expect(list.searchNodeAt(2).data).toBe(data1p5);
    expect(list.searchNodeAt(1).data).toBe(data1);
    expect(list.searchNodeAt(3).data).toBe(data2);

  });



  it("Should add 2 nodes and insert 3rd in the middle, then delete the middle using the remove function", function() {

    var list = linkedList.makeLinkedList();
    expect(list).not.toBe(null);

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data1p5 = {
      "data1.5": 1.5
    };

    list.add(data1);
    var node = list.add(data2);

    var middle = list.insertAt(node, data1p5);

    expect(list.length()).toBe(3);
    expect(list.searchNodeAt(2).data).toBe(data1p5);
    expect(list.searchNodeAt(1).data).toBe(data1);
    expect(list.searchNodeAt(3).data).toBe(data2);


    var removed = list.remove(2);
    expect(removed).toBe(middle);


  });



  it("Should add 2 nodes and insert 3rd in the middle, then delete the middle using the removeNode function", function() {

    var list = linkedList.makeLinkedList();
    expect(list).not.toBe(null);

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data1p5 = {
      "data1.5": 1.5
    };

    list.add(data1);
    var node = list.add(data2);

    var middle = list.insertAt(node, data1p5);

    expect(list.length()).toBe(3);
    expect(list.searchNodeAt(2).data).toBe(data1p5);
    expect(list.searchNodeAt(1).data).toBe(data1);
    expect(list.searchNodeAt(3).data).toBe(data2);


    var removed = list.removeNode(middle);
    expect(removed).toBe(middle);

    expect(list.length()).toBe(2);
    expect(list.searchNodeAt(1).data).toBe(data1);
    expect(list.searchNodeAt(2).data).toBe(data2);

  });


  it("Should get data of length 3 from list of length 3", function() {
    var list = linkedList.makeLinkedList();

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data3 = {
      "data3": 3
    };


    list.add(data1);
    list.add(data2);
    list.add(data3);

    var datas = list.getDataArray();

    expect(datas[0]).toBe(data1);
    expect(datas[1]).toBe(data2);
    expect(datas[2]).toBe(data3);

    expect(datas.length).toBe(3);


  });


  it("getDataArray method should get empty array from empty list", function() {

    var list = linkedList.makeLinkedList();

    var datas = list.getDataArray();

    expect(datas.length).toBe(0);

  });


  it("should successfully delete the first node", function() {

    var list = linkedList.makeLinkedList();

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data3 = {
      "data3": 3
    };


    var first = list.add(data1);
    list.add(data2);
    list.add(data3);

    var removed = list.removeNode(first);

    expect(removed).toBe(first);


  });

  it("should successfully delete the last node", function() {

    var list = linkedList.makeLinkedList();

    var data1 = {
      "data1": 1
    };
    var data2 = {
      "data2": 2
    };

    var data3 = {
      "data3": 3
    };


    list.add(data1);
    list.add(data2);
    var last = list.add(data3);

    var removed = list.removeNode(last);

    expect(removed).toBe(last);


  });
});