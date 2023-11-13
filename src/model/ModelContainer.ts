import { Container } from 'inversify';

/**
 * container に 各 Model を登録する
 */
const container = new Container({ skipBaseClassChecks: true });

export default container;
