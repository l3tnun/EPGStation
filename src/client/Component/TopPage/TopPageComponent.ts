import * as m from 'mithril';
import ParentComponent from '../ParentComponent';
import MainLayoutComponent from '../MainLayoutComponent';

/**
* TopPageComponent
*/
class TopPageComponent extends ParentComponent<void> {
    /**
    * page name
    */
    protected getComponentName(): string { return 'TopPage'; }

    /**
    * view
    */
    public view(): m.Children {
        return m(MainLayoutComponent, {
            header: { title: 'EPGStation' },
        });
    }
}

export default TopPageComponent;

