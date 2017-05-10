import { ChangeDetectorRef } from '@angular/core';
import { ISubscription } from 'rxjs/Subscription';

import { LocaleService } from '../services/locale.service';
import { InjectorRef } from '../models/injector-ref';
import { PropertyDecorator } from '../models/types';

/**
 * Property decorator for components to provide the parameter to the localeCurrency pipe.
 */
export function Currency(): PropertyDecorator {

    function DecoratorFactory(target: any, propertyKey?: string): void {
        let subscription: ISubscription;

        const targetNgOnInit: Function = target.ngOnInit;
        function ngOnInit(this: any): void {
            const locale: LocaleService = InjectorRef.Get(LocaleService);
            const changeDetectorRef: ChangeDetectorRef = InjectorRef.Get(ChangeDetectorRef);

            if (typeof propertyKey !== "undefined") {
                this[propertyKey] = locale.getCurrentCurrency();
                // When the currency changes, subscribes to the event & updates currency property.
                subscription = locale.currencyCodeChanged.subscribe(
                    (value: string) => {
                        this[propertyKey] = value;
                        // OnPush Change Detection strategy.
                        if (changeDetectorRef) { changeDetectorRef.markForCheck(); }
                    });
            }

            if (targetNgOnInit) {
                targetNgOnInit.apply(this);
            }
        }
        target.ngOnInit = ngOnInit;

        const targetNgOnDestroy: Function = target.ngOnDestroy;
        function ngOnDestroy(this: any): void {
            if (typeof subscription !== "undefined") {
                subscription.unsubscribe();
            }

            if (targetNgOnDestroy) {
                targetNgOnDestroy.apply(this);
            }
        }
        target.ngOnDestroy = ngOnDestroy;

        if (typeof propertyKey !== "undefined") {
            Object.defineProperty(target, propertyKey, {
                writable: true,
                value: undefined
            });
        }
    }

    return DecoratorFactory;

}
