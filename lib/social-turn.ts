// Handle only standalone social phrases; longer requests still reach analysis.
export function socialTurn(question:unknown){
 if(typeof question!=='string')return null;
 const text=question.trim().replace(/[.!?,，。！!？?～~\s]+$/u,'').toLowerCase();
 const greeting=/^(?:hi|hello|hey|hey there|good morning|good afternoon|good evening|你好|哈囉|哈啰|嗨|早晨)$/u.test(text);
 const farewell=/^(?:bye|bye bye|bye-bye|goodbye|good bye|see you|see ya|take care|good night|goodnight|再見|拜拜|掰掰|晚安|早唞)$/u.test(text);
 if(!greeting&&!farewell)return null;
 const yue=/[\p{Script=Han}]/u.test(text);const message=greeting?(yue?'你好！有咩想了解？':'Hello! What would you like to explore?'):(yue?'拜拜！下次再傾。':'Goodbye! Talk to you next time.');
 return {response_language:yue?'yue-Hant':'en',status:'answered',findings:[],episodes:[],patterns:[],candidates:[],next_question:'',analysis_notice:message,trace:[{stage:'social_reply',model_called:false}],metrics:{engine:'local-social-reply',model_calls:0,tool_calls:0,outcome:'social_reply'}};
}

// Only intercept unmistakable standalone noise; ordinary words, multilingual
// messages and questions containing a quoted string remain eligible for analysis.
export function unclearTurn(question:unknown){
 if(typeof question!=='string')return null;
 const text=question.trim();
 const noise=!/[\p{L}\p{N}]/u.test(text)||(/^[a-z]{16,}$/i.test(text)&&(/[bcdfghjklmnpqrstvwxz]{10,}/i.test(text)||/(.{2,4})\1{3,}/i.test(text)));
 if(!noise)return null;
 return {response_language:'en',status:'needs clarification',findings:[],episodes:[],patterns:[],candidates:[],next_question:'Could you clarify what you would like to know or ask about the conversation?',trace:[{stage:'input_clarification',model_called:false}],metrics:{engine:'local-input-clarification',model_calls:0,tool_calls:0,outcome:'needs_clarification'}};
}
