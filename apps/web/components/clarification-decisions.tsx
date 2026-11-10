import {extractionQuestions} from '../lib/clarification-draft';
/** Unchecked issues persist on the proposal. Check only after updating terms. */
export function ClarificationDecisions({extraction,documentId}:{extraction:unknown;documentId:string}) {
  const questions=extractionQuestions(extraction,documentId);
  if (!questions.length) return null;
  return <fieldset className="section"><legend>Review the AI’s open questions</legend>
    <p className="muted">Unchecked questions stay unresolved on this proposal and block approval requests. Only mark a question resolved after the proposed terms clearly answer it. Everyone still needs to approve those terms.</p>
    {questions.map(question=><label className="check" key={question}><input type="checkbox" name="resolvedAiQuestion" value={question}/><span>I resolved in the proposed terms: {question}</span></label>)}
  </fieldset>;
}
