const { META, DOCS } = require('../../utils/legal-text');

Page({
  data: { title: '', version: META.version, updated: META.updated, contact: META.contact, blocks: [] },
  onLoad(query) {
    const key = (query && query.doc) || 'agreement';
    const doc = DOCS[key] || DOCS.agreement;
    this.setData({ title: doc.title, blocks: doc.blocks });
    wx.setNavigationBarTitle({ title: doc.title });
  },
});
