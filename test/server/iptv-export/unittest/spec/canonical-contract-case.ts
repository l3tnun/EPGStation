import { it } from 'vitest';

export interface CanonicalContractCase {
    readonly caseIdentity: string;
    readonly execute: () => Promise<void> | void;
    readonly id: string;
    readonly locator: string;
    readonly observable: string;
    readonly requirement: string;
}

export const defineCanonicalContract = (
    requirement: string,
    file: string,
    title: string,
    observable: string,
    execute: CanonicalContractCase['execute'],
): CanonicalContractCase => {
    const id = `IPTV-${requirement.slice('Requirement '.length)}`;
    return Object.freeze({
        caseIdentity: `[${id}] ${title}`,
        execute,
        id,
        locator: `test/server/iptv-export/unittest/spec/${file}`,
        observable,
        requirement,
    });
};

export const registerCanonicalContracts = (cases: readonly CanonicalContractCase[]): void => {
    for (const contractCase of cases) {
        it(contractCase.caseIdentity, contractCase.execute);
    }
};
