const fs = require('fs');
const bt = '';
const lines = [];
const add = (...s) => lines.push(...s);
add("/**",
" * modules/quiz/service.ts -- Quiz attempt lifecycle (server-only)",
" * R-SCORE-01: all scoring via scoreAttempt(). BR-02: DB clock only.",
" */",
"import 'server-only';",
"import { withTx, type Tx } from '@/core/db';",
"import { rounds, entries, participants, quizAttempts, attemptQuestions, quizResponses, questionVersions, questionOptions, roundQuestions, scoreRecords } from '@/core/db/schema';",
"import { dbNow } from '@/core/clock';",
"import { writeAudit } from '@/core/audit';",
"import { ConflictError, ValidationError, NotFoundError, ForbiddenError } from '@/core/errors';",
"import { scoreAttempt, type QuestionInput, type ResponseInput } from './score-attempt';",
"import { eq, and, sql, inArray } from 'drizzle-orm';"
);
fs.writeFileSync('src/modules/quiz/service.ts', lines.join('
'), 'utf8');
console.log('wrote', lines.length, 'header lines');
