import { Operation } from 'express-openapi';
import { ReservesModelInterface } from '../../../Model/Api/ReservesModel';
import factory from '../../../Model/ModelFactory';
import { ReservationManageModelInterface } from '../../../Model/Operator/Reservation/ReservationManageModel';
import * as api from '../../api';

export const get: Operation = async(req, res) => {
    const reserves = <ReservesModelInterface> factory.get('ReservesModel');

    try {
        const result = await reserves.getReserve(parseInt(req.params.id, 10));
        if (result !== null) {
            api.responseJSON(res, 200, result);
        } else {
            api.responseError(res, { code: 404,  message: 'program is not found.' });
        }
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約を取得',
    tags: ['reserves'],
    description: '予約を取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'program id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: '予約を取得しました',
            schema: {
                $ref: '#/definitions/Reserve',
            },
        },
        404: {
            description: '指定した program id の予約が存在しなかった',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

export const del: Operation = async(req, res) => {
    const reserves = <ReservesModelInterface> factory.get('ReservesModel');

    try {
        await reserves.cancelReserve(parseInt(req.params.id, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '予約を削除',
    tags: ['reserves'],
    description: '予約を削除する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'program id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: '予約を削除しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

export const put: Operation = async(req, res) => {
    const reserves = <ReservesModelInterface> factory.get('ReservesModel');

    try {
        req.body.programId = req.params.id;
        await reserves.editReserve(req.body);

        api.responseJSON(res, 201, { code: 201 });
        api.notifyClient();
    } catch (err) {
        switch (err.message) {
            case ReservationManageModelInterface.ProgramIsNotFindError:
                api.responseError(res, { code: 404,  message: 'program is not found.' });
                break;
            case ReservationManageModelInterface.EditRuleError:
                api.responseError(res, { code: 406,  message: 'program is rule reserve.' });
                break;
            case ReservationManageModelInterface.IsRecordingError:
                api.responseError(res, { code: 409,  message: 'program is recording.' });
                break;
            default:
                api.responseServerError(res, err.message);
                break;
        }
    }
};

put.apiDoc = {
    summary: '手動予約を更新',
    tags: ['reserves'],
    description: '手動予約を更新する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'program id',
            required: true,
            type: 'integer',
        },
        {
            name: 'body',
            in: 'body',
            required: true,
            schema: {
                $ref: '#/definitions/EditReserve',
            },
        },
    ],
    responses: {
        201: {
            description: '手動予約を更新しました',
        },
        404: {
            description: '指定した program id の予約が存在しなかった',
        },
        406: {
            description: '更新しようとした予約がルール予約なため更新できない',
        },
        409: {
            description: '録画中のため更新できない',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

