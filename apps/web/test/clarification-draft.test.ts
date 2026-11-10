import test from 'node:test';
import assert from 'node:assert/strict';
import {extractionQuestions,proposalQuestions} from '../lib/clarification-draft';
const extraction={documentId:'d',status:'REVIEW_REQUIRED',requiresHumanReview:true,executable:false,issues:[{question:'Which costs count?'},{question:'Who paid the advance?'}]};
test('AI questions arriving after initial form mount persist even with empty manual field',()=>{
  assert.deepEqual(proposalQuestions('',extraction,'d',new Set()),['Which costs count?','Who paid the advance?']);
});
test('only explicit individual resolutions remove questions, preserving other manual questions',()=>{
  assert.deepEqual(proposalQuestions('Confirm term dates\nWhich costs count?',extraction,'d',new Set(['Who paid the advance?'])),['Confirm term dates','Which costs count?']);
});
test('stale foreign extraction and malformed issues are not proposed',()=>{
  assert.deepEqual(extractionQuestions(extraction,'different-document'),[]);
  assert.deepEqual(extractionQuestions({...extraction,executable:true},'d'),[]);
  assert.deepEqual(extractionQuestions({...extraction,issues:[null,{question:1},{question:'  '},{question:'Same'},{question:'Same'}]},'d'),['Same']);
});
