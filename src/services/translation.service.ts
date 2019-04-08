import { Injectable, Inject } from '@angular/core';
import { Observer, Observable, Subject, BehaviorSubject, race, combineLatest, merge, concat } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import { LocaleService } from './locale.service';
import { TranslationProvider } from './translation-provider';
import { TranslationHandler } from './translation-handler';
import { InjectorRef } from '../models/injector-ref';
import { L10N_CONFIG, L10nConfigRef } from "../models/l10n-config";
import { mergeDeep } from '../models/merge-deep';
import { ProviderType } from '../models/types';
import {logger} from "codelyzer/util/logger";

export interface ITranslationService {

    translationError: Subject<any>;

    getConfiguration(): L10nConfigRef['translation'];

    init(): Promise<any>;

    loadTranslation(): Promise<any>;

    translationChanged(): Observable<string>;

    latestTranslation(): Observable<string>;

    translate(keys: string | string[], args?: any, lang?: string): string | any;

    translateAsync(keys: string | string[], args?: any, lang?: string): Observable<string | any>;

}

/**
 * Manages the translation data.
 */
@Injectable() export class TranslationService implements ITranslationService {

    /**
     * Fired when the translation data could not been loaded. Returns the error.
     */
    public translationError: Subject<any> = new Subject<any>();

    private translation: BehaviorSubject<string> = new BehaviorSubject<string>('');

    /**
     * The translation data: {language: {key: value}}.
     */
    private translationData: any = {};

    constructor(
        @Inject(L10N_CONFIG) private configuration: L10nConfigRef,
        private locale: LocaleService,
        private translationProvider: TranslationProvider,
        private translationHandler: TranslationHandler,
        private injector: InjectorRef
    ) {
        this.injector.translations.push(this);
    }

    public getConfiguration(): L10nConfigRef['translation'] {
        return this.configuration.translation;
    }

    public async init(): Promise<any> {
        // When the language or the default locale changes, loads translation data.
        race(this.locale.languageCodeChanged, this.locale.defaultLocaleChanged).subscribe(
            () => {
                this.loadTranslation()
                    .catch((error: any) => null);
            }
        );

        await this.loadTranslation()
            .catch((error: any) => { throw error; });
    }

    /**
     * Forces the translation loading for the current language.
     */
    public async loadTranslation(): Promise<any> {
        let language: string;
        if (this.configuration.translation.composedLanguage) {
            language = this.locale.composeLocale(this.configuration.translation.composedLanguage);
        } else {
            language = this.locale.getCurrentLanguage();
        }
        if (language) {
            this.translationData = {};

            if (this.configuration.translation.translationData) {
                this.getTranslation(language);
            }
            if (this.configuration.translation.providers) {
                await this.getTranslationAsync(language)
                    .toPromise()
                    .catch((error: any) => { throw error; });
            }
        }
    }

    /**
     * Fired when the translation data has been loaded. Returns the translation language.
     */
    public translationChanged(): Observable<string> {
        return this.translation.asObservable();
    }

    /**
     * Fired when the latest 'translationChanged' is emitted. Returns the translation language.
     * Used when the reference to the service is not known, as in decorators.
     */
    public latestTranslation(): Observable<string> {
        const sequencesOfTranslation: Array<Observable<any>> = [];
        for (const translation of this.injector.translations) {
            sequencesOfTranslation.push(translation.translationChanged());
        }
        return combineLatest(sequencesOfTranslation).pipe(
            filter((languages: string[]) =>
                languages.length == sequencesOfTranslation.length &&
                languages.every((lang: string, i: number, arr: string[]) => lang == arr[0])
            ),
            map((languages: string[]) => languages[0])
        );
    }

    /**
     * Translates a key or an array of keys.
     * @param keys The key or an array of keys to be translated
     * @param args Optional parameters contained in the key
     * @param lang The current language of the service is used by default
     * @return The translated value or an object: {key: value}
     */
    public translate(
        keys: string | string[],
        args?: any,
        lang?: string
    ): string | any {
        if (Array.isArray(keys)) {
            const data: any = {};
            for (const key of keys) {
                data[key] = this.translateKey(key, args, lang || this.translation.getValue());
            }
            return data;
        }
        return this.translateKey(keys, args, lang || this.translation.getValue());
    }

    public translateAsync(
        keys: string | string[],
        args?: any,
        lang?: string
    ): Observable<string | any> {
        return Observable.create((observer: Observer<string | any>) => {
            const values: string | any = this.translate(keys, args, lang);
            observer.next(values);
            observer.complete();
        });
    }

    private translateKey(key: string, args: any, lang: string): string | any {
        // I18n plural.
        if (this.configuration.translation.i18nPlural && /^\d+\b/.exec(key)) {
            return this.translateI18nPlural(key, args, lang);
        }
        return this.getValue(key, args, lang);
    }

    private getValue(key: string, args: any, lang: string): string | any {
        const translationsData: any = this.translationData[lang];
        const translation: object | any = this.getTranslationByKey(key, translationsData);
        return this.translationHandler.parseValue(key, translation.key, translation.value, args, lang);
    }

    private getTranslationByKey(key: string, translationData: any): object {
        const searchReferences: boolean = key.includes('@:');

        let value: string;

        if (!translationData) {
            return this.getMissingTranslationMessage();
        } else if (this.configuration.translation.composedKeySeparator) {
            if (searchReferences) {
                value = key.split(' ').map((keyPath: string) => {
                    if (keyPath.includes('@:')) {
                        return this.getTranslationByKey(keyPath, translationData);
                    } else {
                        return this.translateKeyArray(key.split(this.configuration.translation.composedKeySeparator),
                            translationData);
                    }
                });

            } else {
                const sequences: string[] = key.split(this.configuration.translation.composedKeySeparator);
                value = this.translateKeyArray(sequences, translationData);
            }
        } else {
            value = this.translateBySingleKey(key, translationData);
        }

        return {
            key,
            value
        };
    }

    private translateKeyArray(sequences: string[], translations: object | any): object | string | any {
        try {
            return sequences.reduce((acc: object, sequence: string) => {
                if (acc[sequence]) {
                    return acc[sequence];
                }
                throw  new Error('translations missed');
            }, translations);
        } catch (e) {
            return this.getMissingTranslationMessage();
        }
    }

    private translateBySingleKey(key: string, translations: Object | any): string {
        return translations[key]
            ? translations[key]
            : this.getMissingTranslationMessage();
    }

    private getMissingTranslationMessage(): string {
        return this.configuration.translation.missingKey || "";
    }

    private translateI18nPlural(key: string, args: any, lang: string): string {
        let keyText: string = key.replace(/^\d+\b/, "");
        keyText = keyText.trim();
        const keyNumber: number = parseFloat(key);
        if (!isNaN(keyNumber)) {
            key = key.replace(/^\d+/, this.locale.formatDecimal(keyNumber));
        }
        return key.replace(keyText, this.getValue(keyText, args, lang));
    }

    private getTranslation(language: string): void {
        const translations: any[] = this.configuration.translation.translationData!.filter((value: any) => value.languageCode == language);
        for (const translation of translations) {
            this.addData(translation.data, language);
        }
        if (!this.configuration.translation.providers) {
            this.releaseTranslation(language);
        }
    }

    private getTranslationAsync(language: string): Observable<any> {
        return Observable.create((observer: Observer<any>) => {
            const sequencesOfOrderedTranslationData: Array<Observable<any>> = [];
            const sequencesOfTranslationData: Array<Observable<any>> = [];

            for (const provider of this.configuration.translation.providers!) {
                if (typeof provider.type !== "undefined" && provider.type == ProviderType.Fallback) {
                    let fallbackLanguage: string = language;
                    if (provider.fallbackLanguage) {
                        fallbackLanguage = this.locale.composeLocale(provider.fallbackLanguage);
                    }
                    sequencesOfOrderedTranslationData.push(
                        this.translationProvider.getTranslation(fallbackLanguage, provider)
                    );
                } else {
                    sequencesOfTranslationData.push(
                        this.translationProvider.getTranslation(language, provider)
                    );
                }
            }

            // Merges all the sequences into a single observable sequence.
            const mergedSequencesOfTranslationData: Observable<any> = merge(...sequencesOfTranslationData);
            // Adds to ordered sequences.
            sequencesOfOrderedTranslationData.push(mergedSequencesOfTranslationData);

            concat(...sequencesOfOrderedTranslationData).subscribe(
                (data: any) => {
                    this.addData(data, language);
                },
                (error: any) => {
                    this.handleError(error, language);
                    observer.error(error);
                    observer.complete();
                },
                () => {
                    this.releaseTranslation(language);
                    observer.next(null);
                    observer.complete();
                }
            );
        });
    }

    private addData(data: any, language: string): void {
        this.translationData[language] = typeof this.translationData[language] !== "undefined"
            ? mergeDeep(this.translationData[language], data)
            : data;
    }

    private releaseTranslation(language: string): void {
        this.translation.next(language);
    }

    private handleError(error: any, language: string): void {
        if (this.configuration.translation.rollbackOnError) {
            this.locale.rollback();
        } else {
            this.releaseTranslation(language);
        }
        this.translationError.next(error);
    }

}
