import * as DBSchema from '../DB/DBSchema';

namespace ApiUtil {
    /**
    * DBSchema.ProgramSchema の修正
    * @param program: DBSchema.ProgramSchema
    * @return any[]
    */
    export const fixReserveProgram = (program: DBSchema.ProgramSchema): {} => {
        delete program.startHour;
        delete program.week;
        delete program.duration;

        return ApiUtil.deleteNullinHash(program);
    }

    /**
    * hash か null 値のものを削除
    * @param hash: hash
    * @return null 値が削除された hash
    */
    export const deleteNullinHash = (hash: {}): {} => {
        for(let key in hash) {
            if(hash[key] === null) {
                delete hash[key];
            }
        }

        return hash;
    }

    /**
    * id 付き要素を並び替え
    * @param items: 並び替える要素
    * @param order: 並び替える順番
    * @return items
    */
    export const sortItems = <T>(items: { id: number }[], order: number[]): T => {
        let cnt = 0;
        order.forEach((id) => {
            const i = items.findIndex((item) => {
                return item.id === id;
            });

            if(i === -1) { return; }

            const [item] = items.splice(i, 1);
            items.splice(cnt, 0, item);
            cnt += 1;
        });

        return items as any;
    }
}

export default ApiUtil;

