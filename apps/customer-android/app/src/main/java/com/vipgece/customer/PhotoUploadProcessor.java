package com.vipgece.customer;

import java.io.IOException;
import java.util.function.BooleanSupplier;

final class PhotoUploadProcessor {
    enum Outcome { COMPLETE, RETRY, STOP }
    interface Sender { void send(PendingPhotoStore.Entry entry,byte[] original) throws Exception; }
    static Outcome run(PendingPhotoStore store,String id,String account,int attempt,BooleanSupplier stopped,Sender sender) throws IOException {
        PendingPhotoStore.Entry entry=store.load(id);
        if(entry.terminal())return entry.state==PendingPhotoStore.State.DONE?Outcome.COMPLETE:Outcome.STOP;
        if(!entry.accountId.equals(account)){
            store.state(id,entry.accountId,PendingPhotoStore.State.AUTH_REQUIRED,"SESSION_REQUIRED");return Outcome.STOP;
        }
        if(stopped.getAsBoolean())return Outcome.STOP;
        byte[] original;
        try {original=store.original(id,account);}
        catch(IOException damaged){store.state(id,account,PendingPhotoStore.State.FAILED,"ORIGINAL_DAMAGED");return Outcome.STOP;}
        if(store.state(id,account,PendingPhotoStore.State.UPLOADING,"").terminal()||stopped.getAsBoolean())return Outcome.STOP;
        try {
            sender.send(entry,original);
            PendingPhotoStore.Entry completed=store.state(id,account,PendingPhotoStore.State.DONE,"");
            return completed.state==PendingPhotoStore.State.DONE?Outcome.COMPLETE:Outcome.STOP;
        }catch(ApiClient.Failure failure){
            if(failure.status==401||"PASSWORD_CHANGE_REQUIRED".equals(failure.code)){
                store.state(id,account,PendingPhotoStore.State.AUTH_REQUIRED,"SESSION_REQUIRED");return Outcome.STOP;
            }
            if(failure.status<500&&failure.status!=429){
                store.state(id,account,PendingPhotoStore.State.FAILED,"REQUEST_REJECTED");return Outcome.STOP;
            }
        }catch(IOException transientFailure){
            // Retain byte-exact input and the same ID after ambiguous network outcomes.
        }catch(Exception invalid){
            store.state(id,account,PendingPhotoStore.State.FAILED,"UPLOAD_FAILED");return Outcome.STOP;
        }
        boolean retry=attempt<7;
        store.state(id,account,retry?PendingPhotoStore.State.RETRYING:PendingPhotoStore.State.FAILED,"NETWORK_RETRY");
        return retry?Outcome.RETRY:Outcome.STOP;
    }
}
