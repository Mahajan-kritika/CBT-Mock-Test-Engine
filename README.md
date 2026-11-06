# CBT Mock Test Engine

A client-side, computer-based test simulator built with HTML, CSS and vanilla JavaScript. Question papers are imported from JSON; exam answers, timer state and question timings are saved in the browser's LocalStorage. No backend or package installation is required.

## Run the application

The sample paper is loaded with `fetch`, so serve this folder over HTTP rather than opening `index.html` directly:

1. Open a terminal in this folder.
2. Start a static web server, for example:

   ```sh
   npx serve .
   ```

   Or use another static server of your choice.
3. Open the local URL printed by the server.
4. Choose **Load the 15-question sample**, or import a `.json` file.

The app also supports importing a paper after a test has been completed. An unfinished test must be confirmed before a different paper can replace it.

## Taking a test

1. Load a paper and review its subjects, duration and per-subject marks.
2. Select **Review instructions and start**, then **Begin examination**.
3. Select an option, move with **Previous** / **Save & Next**, or jump from the question palette. Use **Mark for review** to flag a question and **Clear response** to remove an answer.
4. Submit with **Submit Test**. The app warns about unanswered questions. The test submits automatically when time expires.
5. Review the overall and subject-wise results, question explanations and time analysis. Export the result dashboard as a JSON file.

The subject selector jumps to that subject's first question. The palette contains every question across all subjects. Keyboard shortcuts: **← / →** move between questions and **1–4** select options A–D. Full-screen mode is optional.

## Progress recovery and privacy

An in-progress paper and answers are stored in LocalStorage on the current browser and device. The timer is based on the saved absolute end timestamp; refreshing the page does not reset it. On return, use **Resume examination** to continue. Clearing browser storage or using a different browser/device removes access to saved progress. Use **Clear saved test progress** to permanently remove the saved paper and answers; the app asks for confirmation first.

## Question-paper JSON format

Each file must be a UTF-8 JSON object with a non-empty title, a positive duration and one or more subjects. Each subject must have a unique name, a positive-mark value, a non-negative penalty, and at least one question. Every question has an ID, text, four options labelled A–D and a correct-answer key. `explanation` is optional.

```json
{
  "testTitle": "General Mock Examination",
  "durationMinutes": 30,
  "subjects": [
    {
      "name": "Physics",
      "positiveMarks": 4,
      "negativeMarks": 1,
      "questions": [
        {
          "id": 1,
          "question": "What is the SI unit of electric charge?",
          "options": {
            "A": "Volt",
            "B": "Coulomb",
            "C": "Ohm",
            "D": "Tesla"
          },
          "correctAnswer": "B",
          "explanation": "Coulomb is the SI unit of electric charge."
        }
      ]
    }
  ]
}
```

### Field reference

| Field | Type | Requirement |
|---|---|---|
| `testTitle` | string | Required; non-empty |
| `durationMinutes` | number | Required; greater than zero |
| `subjects` | array | Required; at least one subject |
| `subjects[].name` | string | Required; non-empty and unique |
| `subjects[].positiveMarks` | number | Required; zero or greater |
| `subjects[].negativeMarks` | number | Required; zero or greater; deducted for incorrect answers |
| `subjects[].questions` | array | Required; at least one question |
| `questions[].id` | string or number | Required |
| `questions[].question` | string | Required; non-empty |
| `questions[].options` | object | Required; non-empty string values for A, B, C and D |
| `questions[].correctAnswer` | string | Required; one of `A`, `B`, `C`, `D` |
| `questions[].explanation` | string | Optional |

Unanswered questions receive zero marks. Maximum marks are calculated by summing the positive marks for every question. Each question uses the marking scheme of its subject. Duplicate question IDs across different subjects are allowed.

## Included sample

[`sample-questions.json`](./sample-questions.json) contains 15 multiple-choice questions across Physics, Chemistry and Mathematics. It can be loaded in the app or used as a template for additional question papers. Edit the JSON data, preserve the schema, and import the new `.json` file; application source changes are not needed.
