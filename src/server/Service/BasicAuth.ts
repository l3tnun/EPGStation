import * as auth from 'basic-auth';
import * as express from 'express';

/**
 * Basic Auth
 * @param user: user name
 * @param pass: password
 */
export default (user: string, pass: string) => {
    return (request: express.Request, response: express.Response, next: express.NextFunction): express.Response | void => {
        const result = auth(request);

        if (typeof result === 'undefined' || result.name !== user || result.pass !== pass) {
            // 認証を求める
            response.set('WWW-Authenticate', 'Basic realm="EPGStation"');

            return response.status(401).send();
        }

        return next();
    };
};

