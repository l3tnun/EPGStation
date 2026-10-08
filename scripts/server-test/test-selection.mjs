import picomatch from 'picomatch';
import { recordingExecutionTestTargets as recordingTargets } from '../../test/server/recording-execution/domain-suite-matrix.mjs';

export const projectNames = ['spec', 'imp', 'integration'];
export const recordingExecutionTestTargets = Object.freeze(
    recordingTargets.map(target => Object.freeze({ ...target })),
);

export const specificationPatterns = [
    '**/*.spec.test.ts',
    '**/*.cross-spec.test.ts',
    '**/spec/**/*.test.ts',
    '**/unittest/spec/**/*.test.ts',
];
export const integrationPatterns = [
    '**/*.integration.test.ts',
    '**/integration/**/*.test.ts',
    'program-guide/public-api.contract.test.ts',
];
export const implementationPatterns = [
    '**/*.imp.test.ts',
    '**/imp/**/*.test.ts',
    '**/implementation/**/*.test.ts',
    '**/characterization/**/*.test.ts',
    '**/*.test.ts',
];

const artifactExclusions = ['.artifacts/**', '**/.artifacts/**'];
const specExclusions = [
    ...artifactExclusions,
    '**/*.integration.test.ts',
    '**/integration/**/*.test.ts',
    '**/*.imp.test.ts',
    '**/imp/**/*.test.ts',
    '**/implementation/**/*.test.ts',
    '**/characterization/**/*.test.ts',
];
const integrationExclusions = [
    ...artifactExclusions,
    '**/*.spec.test.ts',
    '**/*.cross-spec.test.ts',
    '**/spec/**/*.test.ts',
    '**/unittest/spec/**/*.test.ts',
    '**/*.imp.test.ts',
    '**/imp/**/*.test.ts',
    '**/implementation/**/*.test.ts',
    '**/characterization/**/*.test.ts',
];
const implementationExclusions = [
    ...artifactExclusions,
    '**/*.spec.test.ts',
    '**/*.cross-spec.test.ts',
    '**/spec/**/*.test.ts',
    '**/unittest/spec/**/*.test.ts',
    '**/*.integration.test.ts',
    '**/integration/**/*.test.ts',
    'program-guide/public-api.contract.test.ts',
];

export const exclusionPatterns = {
    spec: specExclusions,
    imp: implementationExclusions,
    integration: integrationExclusions,
};

function normalized(path) {
    return path.replaceAll('\\', '/');
}

export function isServerTestArtifactPath(path) {
    return normalized(path).split('/').includes('.artifacts');
}

function isIntegration(path) {
    return (
        path.endsWith('.integration.test.ts') ||
        path.includes('/integration/') ||
        path.endsWith('program-guide/public-api.contract.test.ts')
    );
}

function isSpecification(path) {
    return (
        path.endsWith('.spec.test.ts') ||
        path.endsWith('.cross-spec.test.ts') ||
        path.includes('/spec/') ||
        path.includes('/unittest/spec/')
    );
}

export function classifyServerTestPath(path) {
    const candidate = normalized(path);
    if (isServerTestArtifactPath(candidate) || !candidate.endsWith('.test.ts')) {
        return [];
    }
    if (isIntegration(candidate)) {
        return ['integration'];
    }
    if (isSpecification(candidate)) {
        return ['spec'];
    }
    return ['imp'];
}

const projectPatterns = {
    spec: { exclude: exclusionPatterns.spec, include: specificationPatterns },
    imp: { exclude: exclusionPatterns.imp, include: implementationPatterns },
    integration: { exclude: exclusionPatterns.integration, include: integrationPatterns },
};

export function matchesProjectPatterns(path) {
    const candidate = normalized(path).replace(/^test\/server\//u, '');
    return projectNames.filter(project => {
        const patterns = projectPatterns[project];
        const options = { dot: true };
        return (
            picomatch.isMatch(candidate, patterns.include, options) &&
            !picomatch.isMatch(candidate, patterns.exclude, options)
        );
    });
}
