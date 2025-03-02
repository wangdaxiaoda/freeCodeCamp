// the config files are created during the build, but not before linting
// eslint-disable-next-line import/no-unresolved
import frameRunnerData from '../../../../../config/client/frame-runner.json';
// eslint-disable-next-line import/no-unresolved
import testEvaluatorData from '../../../../../config/client/test-evaluator.json';
import { challengeTypes } from '../../../../utils/challengeTypes';
import { cssToHtml, jsToHtml, concatHtml } from '../rechallenge/builders.js';
import { getTransformers } from '../rechallenge/transformers';
import {
  createTestFramer,
  runTestInTestFrame,
  createMainFramer
} from './frame';
import createWorker from './worker-executor';

const { filename: runner } = frameRunnerData;
const { filename: testEvaluator } = testEvaluatorData;

const frameRunner = [
  {
    src: `/js/${runner}.js`
  }
];

const globalRequires = [
  {
    link:
      'https://cdnjs.cloudflare.com/' +
      'ajax/libs/normalize/4.2.0/normalize.min.css'
  }
];

const applyFunction = fn =>
  async function (file) {
    try {
      if (file.error) {
        return file;
      }
      const newFile = await fn.call(this, file);
      if (typeof newFile !== 'undefined') {
        return newFile;
      }
      return file;
    } catch (error) {
      return { ...file, error };
    }
  };

const composeFunctions = (...fns) =>
  fns.map(applyFunction).reduce((f, g) => x => f(x).then(g));

function buildSourceMap(files) {
  // TODO: concatenating the source/contents is a quick hack for multi-file
  // editing. It is used because all the files (js, html and css) end up with
  // the same name 'index'. This made the last file the only file to  appear in
  // sources.
  // A better solution is to store and handle them separately. Perhaps never
  // setting the name to 'index'. Use 'contents' instead?
  // TODO: is file.source ever defined?
  return files.reduce(
    (sources, file) => {
      sources[file.name] += file.source || file.contents;
      sources.editableContents += file.editableContents || '';
      return sources;
    },
    { index: '', editableContents: '' }
  );
}

function checkFilesErrors(files) {
  const errors = files.filter(({ error }) => error).map(({ error }) => error);
  if (errors.length) {
    throw errors;
  }
  return files;
}

const buildFunctions = {
  [challengeTypes.js]: buildJSChallenge,
  [challengeTypes.bonfire]: buildJSChallenge,
  [challengeTypes.html]: buildDOMChallenge,
  [challengeTypes.modern]: buildDOMChallenge,
  [challengeTypes.backend]: buildBackendChallenge,
  [challengeTypes.backEndProject]: buildBackendChallenge,
  [challengeTypes.pythonProject]: buildBackendChallenge
};

export function canBuildChallenge(challengeData) {
  const { challengeType } = challengeData;
  return buildFunctions.hasOwnProperty(challengeType);
}

export async function buildChallenge(challengeData, options) {
  const { challengeType } = challengeData;
  let build = buildFunctions[challengeType];
  if (build) {
    return build(challengeData, options);
  }
  throw new Error(`Cannot build challenge of type ${challengeType}`);
}

const testRunners = {
  [challengeTypes.js]: getJSTestRunner,
  [challengeTypes.html]: getDOMTestRunner,
  [challengeTypes.backend]: getDOMTestRunner,
  [challengeTypes.pythonProject]: getDOMTestRunner
};
export function getTestRunner(buildData, runnerConfig, document) {
  const { challengeType } = buildData;
  const testRunner = testRunners[challengeType];
  if (testRunner) {
    return testRunner(buildData, runnerConfig, document);
  }
  throw new Error(`Cannot get test runner for challenge type ${challengeType}`);
}

function getJSTestRunner({ build, sources }, { proxyLogger, removeComments }) {
  const code = {
    contents: sources.index,
    editableContents: sources.editableContents
  };

  const testWorker = createWorker(testEvaluator, { terminateWorker: true });

  return (testString, testTimeout, firstTest = true) => {
    return testWorker
      .execute(
        { build, testString, code, sources, firstTest, removeComments },
        testTimeout
      )
      .on('LOG', proxyLogger).done;
  };
}

async function getDOMTestRunner(buildData, { proxyLogger }, document) {
  await new Promise(resolve =>
    createTestFramer(document, resolve, proxyLogger)(buildData)
  );
  return (testString, testTimeout) =>
    runTestInTestFrame(document, testString, testTimeout);
}

export function buildDOMChallenge({ files, required = [], template = '' }) {
  const finalRequires = [...globalRequires, ...required, ...frameRunner];
  const loadEnzyme = Object.keys(files).some(key => files[key].ext === 'jsx');
  const toHtml = [jsToHtml, cssToHtml];
  const pipeLine = composeFunctions(...getTransformers(), ...toHtml);
  const finalFiles = Object.keys(files)
    .map(key => files[key])
    .map(pipeLine);
  return Promise.all(finalFiles)
    .then(checkFilesErrors)
    .then(files => ({
      challengeType: challengeTypes.html,
      build: concatHtml({ required: finalRequires, template, files }),
      sources: buildSourceMap(files),
      loadEnzyme
    }));
}

export function buildJSChallenge({ files }, options) {
  const pipeLine = composeFunctions(...getTransformers(options));

  const finalFiles = Object.keys(files)
    .map(key => files[key])
    .map(pipeLine);
  return Promise.all(finalFiles)
    .then(checkFilesErrors)
    .then(files => ({
      challengeType: challengeTypes.js,
      build: files
        .reduce(
          (body, file) => [...body, file.head, file.contents, file.tail],
          []
        )
        .join('\n'),
      sources: buildSourceMap(files)
    }));
}

export function buildBackendChallenge({ url }) {
  return {
    challengeType: challengeTypes.backend,
    build: concatHtml({ required: frameRunner }),
    sources: { url }
  };
}

export async function updatePreview(buildData, document, proxyLogger) {
  const { challengeType } = buildData;

  if (challengeType === challengeTypes.html) {
    await new Promise(resolve =>
      createMainFramer(document, resolve, proxyLogger)(buildData)
    );
  } else {
    throw new Error(`Cannot show preview for challenge type ${challengeType}`);
  }
}

export function challengeHasPreview({ challengeType }) {
  return (
    challengeType === challengeTypes.html ||
    challengeType === challengeTypes.modern
  );
}

export function isJavaScriptChallenge({ challengeType }) {
  return (
    challengeType === challengeTypes.js ||
    challengeType === challengeTypes.bonfire
  );
}

export function isLoopProtected(challengeMeta) {
  return challengeMeta.superBlock !== 'Coding Interview Prep';
}
