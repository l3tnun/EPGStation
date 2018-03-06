/**
 * 超手抜き swagger-ui-express 定義
 */
declare namespace SwaggerUiExpress {
    export const serve: any;
    export const setup: any;
}

declare module 'swagger-ui-express' {
    export = SwaggerUiExpress;
}
